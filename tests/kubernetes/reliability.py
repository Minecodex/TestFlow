"""Real-Pod terminal ordering, image identity, preparation and database outage tests."""
import argparse
import asyncio
from copy import deepcopy
import json
import os
from pathlib import Path
import subprocess
from uuid import uuid4

from support import kube_connection, KubernetesTarget, load_local_images, remove_local_images

import httpx

ROOT = Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser()
p.add_argument('--namespace', required=True)
a = p.parse_args()
access = json.loads((ROOT / '.data/kubernetes' / a.namespace / 'access.json').read_text())
if not a.namespace.startswith('testflow-e2e-'):
    raise SystemExit('Destructive dependency tests require an isolated acceptance namespace')
cli, env = kube_connection(access, a.namespace)
destination = ROOT / '.data/acceptance' / a.namespace
destination.mkdir(parents=True, exist_ok=True)
evidence = {'namespace': a.namespace, 'checks': [], 'executions': []}

def kube(*command):
    return subprocess.run(cli + list(command), env=env, check=True, capture_output=True, text=True).stdout

def check(value, message):
    if not value:
        raise AssertionError(message)

async def main():
    async with httpx.AsyncClient(base_url=access['url'] + '/api/v1', timeout=30, trust_env=False) as http:
        async def call(method, path, body=None, **kwargs):
            response = await http.request(method, path, json=body, **kwargs)
            check(response.is_success, f'{method} {path}: {response.status_code} {response.text[:300]}')
            return response.json()
        async def operation(identifier):
            async with asyncio.timeout(100):
                while True:
                    row = await call('GET', '/operations/' + identifier)
                    if row['state'] not in {'queued', 'running'}:
                        check(row['state'] == 'succeeded', str(row.get('error')))
                        return row
                    await asyncio.sleep(.2)
        async def ended(identifier):
            async with asyncio.timeout(100):
                while True:
                    row = await call('GET', '/executions/' + identifier)
                    if row['state'] not in {'queued', 'running'} and row['cleanup'] != 'stopping' and row['evaluations'] and row['evaluations'][0]['state'] not in {'queued', 'running'}:
                        check(sum(e['kind'] in {'execution.succeeded', 'execution.failed', 'execution.canceled'} for e in row['events']) == 1, 'Exactly one terminal')
                        evidence['executions'].append({'id': row['id'], 'state': row['state'], 'cleanup': row['cleanup'], 'error': row.get('error')})
                        return row
                    await asyncio.sleep(.2)
        async def running(identifier):
            async with asyncio.timeout(40):
                while True:
                    row = await call('GET', '/executions/' + identifier)
                    if row['nodes'].get('module', {}).get('state') == 'running':
                        return row
                    check(row['state'] in {'queued', 'running'}, 'Expected active module')
                    await asyncio.sleep(.15)
        await call('POST', '/auth/login', {'username': 'admin', 'password': access['password']})
        archive = ROOT / '.data/module-packages/test-fixture-1.0.1.zip'
        module = await call('POST', '/modules/import', files={'file': (archive.name, archive.read_bytes(), 'application/zip')}, headers={'Idempotency-Key': str(uuid4())})
        if module.get('operation_id'):
            await operation(module['operation_id'])
        runtime = module['data']['manifest']['runtime']
        validation = await call('POST', f'/modules/{module["id"]}/validate', runtime, headers={'Idempotency-Key': str(uuid4())})
        await operation(validation['id'])
        inp, out = module['data']['inputs'], module['data']['outputs']
        profile = await call('POST', '/evaluation-profiles', {'name': 'TEST ONLY: reliability rules', 'dimensions': [{'id': 'complete', 'name': 'Completed', 'method': 'completion', 'actual': {'source': 'execution', 'field': 'state'}}]})
        def node(identifier='module', mode='success', delay=0, rt=None):
            return {'id': identifier, 'kind': 'module', 'name': identifier, 'module_id': module['id'], 'module_version': module['selected_version'], 'runtime': rt or runtime, 'parameters': {'mode': mode, 'delay_ms': delay}, 'timeout': 30}
        def end(identifier='end'):
            return {'id': identifier, 'kind': 'end', 'name': identifier, 'input_schema': out, 'output_schema': out}
        async def flow(nodes, edges, name, prepare=60):
            return await call('POST', '/pipelines', {'name': 'TEST ONLY: ' + name, 'input_schema': inp, 'output_schema': out, 'nodes': [{'id': 'start', 'kind': 'start', 'name': 'Start', 'output_schema': inp}, *nodes], 'edges': [{'source': x, 'target': y} for x, y in edges], 'preparation_timeout': prepare, 'cleanup_timeout': 2})
        async def simple(mode='success', delay=0, rt=None, prepare=60):
            return await flow([node(mode=mode, delay=delay, rt=rt), end()], [('start', 'module'), ('module', 'end')], mode, prepare)
        async def quick(pipeline):
            return await call('POST', '/executions/quick', {'pipeline_id': pipeline['id'], 'pipeline_version': 1, 'profile_id': profile['id'], 'profile_version': 1, 'inputs': {'text': {'value': 'reliability'}}}, headers={'Idempotency-Key': str(uuid4())})
        row = await ended((await quick(await simple('late_error')))['id'])
        terminal_position = next(i for i, e in enumerate(row['events']) if e['kind'] == 'execution.succeeded')
        check(row['state'] == 'succeeded' and any(e['kind'] == 'module.event' and e['data'].get('type') == 'execution.error' for e in row['events'][terminal_position + 1:]), 'Late errors must remain evidence after successful EOS')
        evidence['checks'].append('successful_eos_preserved_and_late_error_retained')
        race = await flow([node('bad', 'error'), node('good', 'success', 1500), end('e1'), end('e2')], [('start', 'bad'), ('start', 'good'), ('bad', 'e1'), ('good', 'e2')], 'error before exit')
        row = await ended((await quick(race))['id'])
        check(row['state'] == 'failed' and row['error']['node_id'] == 'bad' and row['winner'] is None, 'First error locks failure before delayed successful exit')
        evidence['checks'].append('error_before_complete_exit_locks_failure')
        # The terminal arrives while PostgreSQL is unavailable; durable writes resume in order.
        execution = await quick(await simple(delay=5000))
        await running(execution['id'])
        try:
            await asyncio.to_thread(kube, 'scale', 'statefulset/testflow-postgres', '--replicas=0')
            await asyncio.to_thread(kube, 'wait', '--for=delete', 'pod/testflow-postgres-0', '--timeout=40s')
            response = await http.get('/executions/' + execution['id'])
            check(response.status_code == 503 and response.json()['request_id'], 'Dependency outage is a standard 503 with request ID')
            await asyncio.sleep(5)
        finally:
            await asyncio.to_thread(kube, 'scale', 'statefulset/testflow-postgres', '--replicas=1')
            await asyncio.to_thread(kube, 'rollout', 'status', 'statefulset/testflow-postgres', '--timeout=60s')
        row = await ended(execution['id'])
        check(row['state'] == 'succeeded' and row['output']['text']['text'] == 'RELIABILITY', 'Database recovery preserves module output and one terminal')
        check(sum(e['kind'] == 'module.request' for e in row['events']) == 1, 'Database retry never invokes module twice')
        evidence['checks'].append('active_database_outage_restores_durable_terminal_without_reinvocation')
        data = await call('POST', '/datasets', {'name': 'TEST ONLY: canceled remaining plans', 'input_schema': inp, 'output_schema': out, 'cases': [{'id': str(uuid4()), 'name': text, 'inputs': {'text': {'value': text}}} for text in ['hang', 'success', 'never_started']]})
        pipeline = await simple('by_input')
        task = await call('POST', '/tasks', {'name': 'TEST ONLY: cancel queued plans', 'pairs': [{'dataset_id': data['id'], 'dataset_version': 1, 'pipeline_id': pipeline['id'], 'pipeline_version': 1}], 'profile_id': profile['id'], 'profile_version': 1}, headers={'Idempotency-Key': str(uuid4())})
        async with asyncio.timeout(40):
            while True:
                detail = await call('GET', '/tasks/' + task['id'])
                active = detail['report']['rows'][0].get('active_execution_id')
                if active:
                    await running(active)
                    break
                await asyncio.sleep(.2)
        await call('POST', '/tasks/' + task['id'] + '/cancel')
        await operation(task['operation_id'])
        detail = await call('GET', '/tasks/' + task['id'])
        check(detail['state'] == 'canceled' and detail['report']['plan_count'] == 3, 'Canceled batch retains frozen denominator')
        check(all(r['plan_state'] == 'canceled' and r['execution_id'] is None for r in detail['report']['rows'][1:]), 'Queued plans do not start after accepted cancel')
        evidence['checks'].append('batch_cancel_stops_remaining_frozen_plans')
        # Only private disposable tags are changed; real example identities remain immutable.
        run_id = uuid4().hex[:10]
        tag = 'testflow/reliability-image:' + run_id
        dockerfile = destination / ('Dockerfile.' + run_id)
        def load(image):
            load_local_images(KubernetesTarget.from_access(access), [image])
        def build(extra):
            dockerfile.write_text('FROM ' + runtime['image'] + '\n' + extra + '\n')
            subprocess.run(['docker', 'build', '-f', str(dockerfile), '-t', tag, str(ROOT)], check=True, capture_output=True)
            load(tag)
        altered = {**runtime, 'image': tag}
        try:
            await asyncio.to_thread(build, 'ENV TESTFLOW_TEST_IMAGE_VARIANT=validated')
            validation = await call('POST', f'/modules/{module["id"]}/validate', altered, headers={'Idempotency-Key': str(uuid4())})
            await operation(validation['id'])
            pipeline = await simple(rt=altered, prepare=4)
            await asyncio.to_thread(build, 'ENV TESTFLOW_TEST_IMAGE_VARIANT=changed')
            row = await ended((await quick(pipeline))['id'])
            check(row['state'] == 'failed' and 'Image identity changed' in row['error']['message'], 'Changed image ID requires a new validated version')
            evidence['checks'].append('immutable_image_identity_change_rejected')
            await asyncio.to_thread(build, 'ENTRYPOINT ["node", "-e", "setInterval(()=>{},1000)"]')
            row = await ended((await quick(pipeline))['id'])
            check(row['state'] == 'failed' and row['error']['code'] == 'preparation_timeout', 'Unready Pod uses preparation deadline')
            check('started_ms' not in row['nodes']['module'], 'Preparation never starts node runtime clock')
            evidence['checks'].append('unready_pod_preparation_timeout_separate_from_runtime')
        finally:
            remove_local_images(KubernetesTarget.from_access(access), [tag])
            subprocess.run(['docker', 'image', 'rm', tag], capture_output=True)
            dockerfile.unlink(missing_ok=True)
        check(not json.loads(kube('get', 'pods', '-l', 'testflow-runtime', '-o', 'json'))['items'], 'Acceptance module Pods reclaimed')
        evidence['checks'].append('all_reliability_module_pods_reclaimed')

try:
    asyncio.run(main())
except Exception as error:
    evidence['failure'] = type(error).__name__ + ': ' + str(error)
    raise
finally:
    path = destination / 'reliability.json'
    path.write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps({'passed': evidence['checks'], 'evidence': str(path)}, indent=2))
