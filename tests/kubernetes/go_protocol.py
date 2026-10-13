"""Direct HTTP/WS cancellation and error checks against the immutable Go image in a real Pod."""
import argparse
import asyncio
import copy
import json
import os
from pathlib import Path
import subprocess
import time
from uuid import uuid4

from support import kube_connection

import httpx
from websockets.asyncio.client import connect
from websockets.exceptions import InvalidStatus

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--namespace', required=True)
parser.add_argument('--port', type=int, default=18813)
args = parser.parse_args()
if not args.namespace.startswith('testflow-e2e-'):
    raise SystemExit('Use a disposable test namespace')
access = json.loads((ROOT / '.data/kubernetes' / args.namespace / 'access.json').read_text())
cli, env = kube_connection(access, args.namespace)
pod_name = 'go-protocol-' + uuid4().hex[:8]
image = next(module['image'] for module in json.loads((ROOT / '.data/example-modules.json').read_text()) if module['id'] == 'image-grayscale')
folder = ROOT / '.data/acceptance' / args.namespace
evidence = {'namespace': args.namespace, 'image': image, 'checks': []}

# A controlled resource service makes an outstanding read observable; no real credential is used.
fixture = '''
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import json,time
active=set()
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_GET(self):
  if self.path == '/probe':
   self.send_response(200);self.end_headers();self.wfile.write(json.dumps(list(active)).encode());return
  if '/slow?' in self.path:
   active.add('slow');time.sleep(10);active.discard('slow')
  self.send_response(500);self.end_headers()
print('Resource fixture listening',flush=True)
ThreadingHTTPServer(('0.0.0.0',18080),Handler).serve_forever()
'''

def kube(*command, stdin=None):
    return subprocess.run(cli + list(command), env=env, input=stdin, text=True, capture_output=True, check=True).stdout

def check(condition, message):
    if not condition:
        raise AssertionError(message)

async def main():
    pod = {'apiVersion': 'v1', 'kind': 'Pod', 'metadata': {'name': pod_name, 'labels': {'testflow.io/acceptance': 'true'}},
           'spec': {'restartPolicy': 'Never', 'automountServiceAccountToken': False, 'containers': [
               {'name': 'go', 'image': image, 'imagePullPolicy': 'Never', 'ports': [{'containerPort': 8080}],
                'readinessProbe': {'httpGet': {'path': '/module/v1/health', 'port': 8080}, 'periodSeconds': 1},
                'env': [{'name': k, 'value': v} for k, v in {'TESTFLOW_PLATFORM_URL': 'http://127.0.0.1:18080',
                          'TESTFLOW_RUNTIME_ID': 'fixture', 'TESTFLOW_RUNTIME_TOKEN': 'test-only-resource-token'}.items()],
                'resources': {'limits': {'cpu': '500m', 'memory': '128Mi'}}},
               {'name': 'resource-fixture', 'image': 'testflow-server:dev', 'imagePullPolicy': 'Never',
                'command': ['/app/.venv/bin/python', '-c', fixture], 'ports': [{'containerPort': 18080}],
                'readinessProbe': {'httpGet': {'path': '/probe', 'port': 18080}, 'periodSeconds': 1},
                'resources': {'limits': {'cpu': '100m', 'memory': '128Mi'}}}]}}
    await asyncio.to_thread(kube, 'apply', '-f', '-', stdin=json.dumps(pod))
    forward = None
    try:
        await asyncio.to_thread(kube, 'wait', '--for=condition=Ready', 'pod/' + pod_name, '--timeout=60s')
        forward_log = (folder / 'go-port-forward.log').open('w')
        forward = subprocess.Popen(cli + ['port-forward', '--address=127.0.0.1', 'pod/' + pod_name,
                                   f'{args.port}:8080', f'{args.port + 1}:18080'], env=env, stdout=forward_log, stderr=subprocess.STDOUT)
        origin = f'http://127.0.0.1:{args.port}'
        async with httpx.AsyncClient(base_url=origin, trust_env=False, timeout=5) as http:
            async with asyncio.timeout(20):
                while True:
                    try:
                        health = await http.get('/module/v1/health')
                        probe = await http.get(f'http://127.0.0.1:{args.port + 1}/probe')
                        if health.is_success and probe.is_success: break
                    except httpx.HTTPError as error: evidence['last_connection_error'] = str(error)
                    await asyncio.sleep(.2)
            async def call(method, path, body=None):
                response = await http.request(method, '/module/v1/' + path, json=body)
                check(response.is_success, f'{method} {path}: {response.status_code}')
                return response.json()
            def body(asset='bad'):
                return {'invocation_id': str(uuid4()), 'parameters': {'caption': 'Test'},
                        'inputs': {'image': {'value': {'asset_id': asset, 'asset_version': 1}}},
                        'context': {'batch_id': 'fixture', 'execution_id': 'fixture', 'node_id': 'go', 'trace_id': 'fixture'}}
            request = body()
            first = await call('POST', 'executions', request)
            check((await call('POST', 'executions', request)) == first, 'Same invocation identity is idempotent')
            changed = copy.deepcopy(request); changed['parameters']['caption'] = 'Changed'
            check((await http.post('/module/v1/executions', json=changed)).status_code == 409, 'Changed body rejected')
            evidence['checks'].append('idempotent_invocation_and_conflict')
            path = 'executions/' + request['invocation_id']
            async with connect(origin.replace('http:', 'ws:') + '/module/v1/' + path + '/stream', proxy=None) as socket:
                event = json.loads(await asyncio.wait_for(socket.recv(), 5))
                check(event['type'] == 'execution.error', 'Resource HTTP error is a protocol error')
            check((await call('GET', path))['state'] == 'failed', 'HTTP state matches error event')
            try:
                async with connect(origin.replace('http:', 'ws:') + '/module/v1/' + path + '/stream', proxy=None):
                    raise AssertionError('Ended invocation was attached twice')
            except InvalidStatus as error:
                check(error.response.status_code == 409, 'No duplicate attachment')
            evidence['checks'].append('http_error_has_failed_state_and_single_stream_attachment')
            request = body(); path = 'executions/' + request['invocation_id']
            await call('POST', 'executions', request)
            check((await call('POST', path + '/cancel'))['state'] == 'canceled', 'Pre-start cancel has no worker')
            check((await call('GET', path))['state'] == 'canceled', 'Cancel persists')
            evidence['checks'].append('cancel_before_stream_attachment')
            request = body('slow'); path = 'executions/' + request['invocation_id']
            await call('POST', 'executions', request)
            async with connect(origin.replace('http:', 'ws:') + '/module/v1/' + path + '/stream', proxy=None) as socket:
                async with asyncio.timeout(5):
                    while 'slow' not in (await http.get(f'http://127.0.0.1:{args.port + 1}/probe')).json():
                        await asyncio.sleep(.05)
                started = time.monotonic()
                await call('POST', path + '/cancel')
                event = json.loads(await asyncio.wait_for(socket.recv(), 3))
                check(event['type'] == 'execution.canceled' and event['remote_stop_confirmed'], 'Worker confirms return after canceled HTTP request')
                evidence['cancel_ms'] = round((time.monotonic() - started) * 1000, 2)
            check((await call('GET', path))['state'] == 'canceled', 'HTTP terminal matches cancel event')
            check((await call('POST', path + '/cancel'))['state'] == 'canceled', 'Repeated cancellation keeps terminal')
            evidence['checks'].append('cancel_interrupts_outstanding_http_and_confirms_worker_stop')
        deployed = json.loads(await asyncio.to_thread(kube, 'get', 'pod', pod_name, '-o', 'json'))
        evidence['image_id'] = next(c['imageID'] for c in deployed['status']['containerStatuses'] if c['name'] == 'go')
        check(evidence['image_id'], 'Actual immutable image identity')
    except Exception:
        evidence['fixture_logs'] = (await asyncio.to_thread(kube, 'logs', pod_name, '-c', 'resource-fixture', '--tail=30'))[-3000:]
        evidence['forward_logs'] = (folder / 'go-port-forward.log').read_text()[-3000:]
        raise
    finally:
        if forward:
            forward.terminate(); await asyncio.to_thread(forward.wait, 10)
            forward_log.close()
        await asyncio.to_thread(kube, 'delete', 'pod', pod_name, '--wait=true', '--timeout=60s')

try:
    asyncio.run(main())
except Exception as error:
    evidence['error'] = str(error)[:500]
    raise
finally:
    path = folder / 'go-protocol.json'
    path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'checks': evidence['checks'], 'evidence': str(path)}, ensure_ascii=False))
