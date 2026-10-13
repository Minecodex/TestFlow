"""Install from the release image, verify the desktop flow, and reclaim resources."""
import argparse
import base64
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from uuid import uuid4

import httpx
import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from kubernetes_support import KubernetesTarget, add_cluster_arguments, load_local_images

parser = argparse.ArgumentParser(description=__doc__)
add_cluster_arguments(parser)
parser.add_argument('--namespace', default='testflow-e2e-beta-' + uuid4().hex[:8])
parser.add_argument('--server-image', default='kakj/testflow-server:v0.0.1-beta')
parser.add_argument('--web-image', default='kakj/testflow-web:v0.0.1-beta')
parser.add_argument('--local-platform-images', action='store_true')
parser.add_argument('--manifest-directory', type=Path, default=ROOT / 'deploy/k8s/beta')
parser.add_argument('--image-renderer', action='store_true', help='Verify the legacy image-rendered installation')
args = parser.parse_args()
if args.image_renderer:
    args.manifest_directory = None
if not args.namespace.startswith('testflow-e2e-'):
    parser.error('An owned disposable namespace is required')
target = KubernetesTarget.from_args(args)
existing = json.loads(target.run('get', 'namespaces', '-o', 'json', text=True).stdout)['items']
if any(item['metadata']['name'] == args.namespace for item in existing):
    raise SystemExit('Existing namespace preserved; select a fresh namespace')
with socket.socket() as listener:
    listener.bind(('127.0.0.1', 0))
    port = listener.getsockname()[1]
output = ROOT / '.data/acceptance' / args.namespace
output.mkdir(parents=True, mode=0o700)
access_directory = ROOT / '.data/kubernetes' / args.namespace
access_directory.mkdir(parents=True, mode=0o700)
forward = None
namespace_created = False
proof = {'namespace': args.namespace, 'context': target.context,
         'image_source': 'local' if args.local_platform_images else 'Docker Hub',
         'checks': [], 'browser': {}, 'cleanup': {}, 'passed': False}


def check(name, condition):
    if not condition:
        raise AssertionError(name)
    proof['checks'].append(name)
    print('PASS ' + name, flush=True)


def normal_snapshot():
    rows = json.loads(target.run('get', 'deployments', '-o', 'json',
                                 namespace='testflow-dev', text=True).stdout)['items']
    return {row['metadata']['name']: {'uid': row['metadata']['uid'], 'spec': row['spec']} for row in rows}


normal_before = normal_snapshot()
try:
    examples = json.loads((ROOT / '.data/example-modules.json').read_text())
    images = [item['image'] for item in examples]
    if args.local_platform_images:
        images += [args.server_image, args.web_image, 'postgres:18']
    elif not args.manifest_directory:
        for image in (args.server_image, args.web_image):
            subprocess.run(['docker', 'pull', image], check=True, capture_output=True, text=True)
    load_local_images(target, images)
    if args.manifest_directory:
        directory = output / 'manifests'
        directory.mkdir()
        items = []
        for source in sorted(args.manifest_directory.glob('*.yaml')):
            documents = list(yaml.safe_load_all(source.read_text()))
            for item in documents:
                if item['kind'] == 'Namespace':
                    item['metadata']['name'] = args.namespace
                    item['metadata']['labels']['testflow-acceptance'] = 'true'
                else:
                    item['metadata']['namespace'] = args.namespace
                if item['kind'] == 'RoleBinding':
                    for subject in item['subjects']:
                        if subject['kind'] == 'ServiceAccount':
                            subject['namespace'] = args.namespace
                if item['kind'] == 'ConfigMap' and item['metadata']['name'] == 'testflow-config':
                    item['data']['TESTFLOW_PUBLIC_URL'] = f'http://127.0.0.1:{port}'
                pod = item.get('spec', {}).get('template', {}).get('spec', {})
                for container in [*pod.get('containers', []), *pod.get('initContainers', [])]:
                    if container['image'].startswith('kakj/testflow-server:'):
                        container['image'] = args.server_image
                    elif container['image'].startswith('kakj/testflow-web:'):
                        container['image'] = args.web_image
                    if not args.local_platform_images and container['image'] in {args.server_image, args.web_image}:
                        container['imagePullPolicy'] = 'Always'
            (directory / source.name).write_text(yaml.safe_dump_all(documents))
            items.extend(documents)
        bundle = {'items': items}
        check('directory contains no pre-generated private secrets', all(item['kind'] != 'Secret' for item in items))
    else:
        target.run('create', 'namespace', args.namespace, text=True)
        namespace_created = True
        manifest_file = access_directory / 'installation.yaml'
        with open(manifest_file, 'x', opener=lambda path, flags: os.open(path, flags, 0o600)) as manifest:
            subprocess.run(['docker', 'run', '--rm', args.server_image,
                            'python', '/app/scripts/render-kubernetes.py', '--namespace', args.namespace,
                            '--port', str(port), '--server-image', args.server_image, '--web-image', args.web_image],
                           stdout=manifest, stderr=subprocess.PIPE, check=True, text=True, timeout=60)
        bundle = yaml.safe_load(manifest_file.read_text())
        check('image-bundled installer creates private manifest', manifest_file.stat().st_mode & 0o777 == 0o600)
    selected = {item['spec']['template']['metadata']['labels']['app']: item['spec']['template']['spec']['containers'][0]['image']
                for item in bundle['items'] if item['kind'] in {'Deployment', 'Job'}}
    check('backend, migration and frontend use selected release images',
          selected['testflow-server'] == selected['testflow-migrate'] == args.server_image and
          selected['testflow-web'] == args.web_image)
    # Remote verification resolves the published tag even when build layers are cached locally.
    if not args.local_platform_images:
        for item in bundle['items']:
            if item['kind'] in {'Deployment', 'Job'}:
                for container in item['spec']['template']['spec']['containers']:
                    container['imagePullPolicy'] = 'Always'
    with (output / 'deployment.log').open('w') as log:
        if args.manifest_directory:
            namespace_created = True
            log.write(target.run('apply', '-f', str(directory), text=True).stdout)
        else:
            log.write(target.run('apply', '-f', '-', input=json.dumps(bundle), text=True,
                                 namespace=args.namespace).stdout)
        jobs = {item['spec']['template']['metadata']['labels']['app']: item['metadata']['name']
                for item in bundle['items'] if item['kind'] == 'Job'}
        if 'testflow-bootstrap' in jobs:
            log.write(target.run('wait', '--for=condition=complete', 'job/' + jobs['testflow-bootstrap'], '--timeout=180s',
                                 namespace=args.namespace, text=True).stdout)
        log.write(target.run('rollout', 'status', 'statefulset/testflow-postgres', '--timeout=180s',
                             namespace=args.namespace, text=True).stdout)
        log.write(target.run('wait', '--for=condition=complete', 'job/' + jobs['testflow-migrate'], '--timeout=180s',
                             namespace=args.namespace, text=True).stdout)
        for name in ('testflow-server', 'testflow-web'):
            log.write(target.run('rollout', 'status', 'deployment/' + name, '--timeout=180s',
                                 namespace=args.namespace, text=True).stdout)
    check('database, migration and both deployments ready', True)
    if args.manifest_directory:
        secret = json.loads(target.run('get', 'secret', 'testflow-secrets', '-o', 'json',
                                        namespace=args.namespace, text=True).stdout)
        encryption_key = base64.b64decode(secret['data']['TESTFLOW_ENCRYPTION_KEY']).decode()
        secrets_before = json.loads(target.run('get', 'secret', 'testflow-secrets', 'testflow-postgres-secret',
                                                '-o', 'json', namespace=args.namespace, text=True).stdout)
        secret_data = lambda rows: {row['metadata']['name']: row['data'] for row in rows['items']}
        target.run('apply', '-f', str(directory), text=True)
        secrets_after = json.loads(target.run('get', 'secret', 'testflow-secrets', 'testflow-postgres-secret',
                                               '-o', 'json', namespace=args.namespace, text=True).stdout)
        check('reapply preserves generated database password and encryption key', secret_data(secrets_before) == secret_data(secrets_after))
    else:
        secret = next(item for item in bundle['items'] if item['kind'] == 'Secret' and item['metadata']['name'] == 'testflow-secrets')
        encryption_key = secret['stringData']['TESTFLOW_ENCRYPTION_KEY']
    access = {'namespace': args.namespace, **target.access_fields(), 'port': port,
              'url': f'http://127.0.0.1:{port}', 'username': 'admin', 'password': '123456',
              'encryption_key': encryption_key}
    with open(access_directory / 'access.json', 'x', opener=lambda path, flags: os.open(path, flags, 0o600)) as file:
        json.dump(access, file, indent=2)
    pods = json.loads(target.run('get', 'pods', '-o', 'json', namespace=args.namespace, text=True).stdout)['items']
    proof['pod_images'] = {pod['metadata']['labels'].get('app'): [
        {'image': status['image'], 'image_id': status.get('imageID')}
        for status in pod.get('status', {}).get('containerStatuses', [])] for pod in pods}
    check('all platform pods resolve actual image IDs',
          all(status['image_id'] for statuses in proof['pod_images'].values() for status in statuses))
    if args.manifest_directory:
        apps = [pod for pod in pods if pod['metadata']['labels'].get('app') in {'testflow-server', 'testflow-web'}]
        check('dependencies complete before applications start', all(
            pod['status']['initContainerStatuses'][0]['state']['terminated']['exitCode'] == 0 and
            pod['status']['containerStatuses'][0]['state']['running']['startedAt'] >=
            pod['status']['initContainerStatuses'][0]['state']['terminated']['finishedAt'] for pod in apps))
    with (output / 'port-forward.log').open('w') as log:
        forward = subprocess.Popen(target.command(args.namespace) + ['port-forward', '--address=127.0.0.1',
                                   'service/testflow-web', f'{port}:8080'], stdout=log, stderr=subprocess.STDOUT)
        with httpx.Client(base_url=access['url'], headers={'Origin': access['url']}, timeout=5) as client:
            for _ in range(80):
                try:
                    if client.get('/healthz').status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                time.sleep(0.25)
            else:
                raise RuntimeError('Portal port forwarding unavailable')
            check('Nginx serves the portal', '<div id="root"></div>' in client.get('/').text)
            login = client.post('/api/v1/auth/login', json={'username': 'admin', 'password': '123456'})
            check('documented initial login and session', login.status_code == 200 and
                  client.get('/api/v1/auth/session').json() == {'username': 'admin'})
            for kind in ('assets', 'modules', 'datasets', 'pipelines'):
                response = client.get('/api/v1/' + kind)
                check('empty initial ' + kind, response.status_code == 200 and response.json()['items'] == [])
        with (output / 'browser.log').open('w') as log:
            subprocess.run(['node', 'tests/node-configuration.e2e.mjs'], cwd=ROOT,
                           env={**os.environ, 'TESTFLOW_E2E_NAMESPACE': args.namespace},
                           stdout=log, stderr=subprocess.STDOUT, check=True, timeout=540)
    report = json.loads((output / 'node-configuration/control-cases.json').read_text())
    proof['browser'] = {'passed': report['passed'], 'cases': len(report['cases']),
                        'layouts': len(report['layouts']), 'javascript_errors': report['errors']}
    check('real module execution and desktop workflow', report['passed'] and not report['errors'])
    if args.manifest_directory:
        target.run('delete', 'job', jobs['testflow-bootstrap'], namespace=args.namespace, text=True)
        target.run('apply', '-f', str(directory), text=True)
        target.run('wait', '--for=condition=complete', 'job/' + jobs['testflow-bootstrap'], '--timeout=180s',
                   namespace=args.namespace, text=True)
        secrets_retry = json.loads(target.run('get', 'secret', 'testflow-secrets', 'testflow-postgres-secret',
                                               '-o', 'json', namespace=args.namespace, text=True).stdout)
        check('bootstrap retry preserves existing private configuration', secret_data(secrets_before) == secret_data(secrets_retry))
    denied = subprocess.run(target.command() + ['create', 'namespace', args.namespace],
                            env=target.environment, text=True, capture_output=True)
    check('namespace creation rejects overwriting existing installation', denied.returncode != 0)
    proof['passed'] = True
finally:
    try:
        trace = output / 'node-configuration/private-trace.zip'
        if trace.exists():
            subprocess.run([sys.executable, 'scripts/sanitize-browser-trace.py', str(trace),
                            str(trace.with_name('trace.zip'))], cwd=ROOT, check=True, capture_output=True)
    finally:
        if forward is not None and forward.poll() is None:
            forward.terminate()
            try:
                forward.wait(timeout=10)
            except subprocess.TimeoutExpired:
                forward.kill()
                forward.wait(timeout=10)
        proof['cleanup']['port_forward_stopped'] = True
        if namespace_created:
            target.run('delete', 'namespace', args.namespace, '--wait=false', text=True)
            deadline = time.monotonic() + 90
            while True:
                present = target.run('get', 'namespace', args.namespace, '--ignore-not-found', '-o', 'name', text=True).stdout
                volumes = json.loads(target.run('get', 'pv', '-o', 'json', text=True).stdout)['items']
                attached = any(item['spec'].get('claimRef', {}).get('namespace') == args.namespace for item in volumes)
                if not present and not attached:
                    proof['cleanup']['namespace_and_volumes_deleted'] = True
                    break
                if time.monotonic() > deadline:
                    raise RuntimeError('Temporary resource cleanup timed out')
                time.sleep(1)
        proof['cleanup']['normal_deployment_preserved'] = normal_snapshot() == normal_before
        (output / 'result.json').write_text(json.dumps(proof, ensure_ascii=False, indent=2) + '\n')

print(json.dumps(proof['browser']), flush=True)
print('Evidence: ' + str((output / 'result.json').relative_to(ROOT)), flush=True)
