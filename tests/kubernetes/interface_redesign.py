"""Deploy a disposable workspace, verify the actual UI, and reclaim its resources."""
import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from kubernetes_support import KubernetesTarget, add_cluster_arguments, load_local_images

parser = argparse.ArgumentParser()
add_cluster_arguments(parser)
parser.add_argument('--namespace', default='testflow-e2e-interface-' + time.strftime('%Y%m%d') + '-' + uuid4().hex[:6])
parser.add_argument('--port', type=int)
parser.add_argument('--load-web-image', action='store_true')
parser.add_argument('--load-images', action='store_true')
parser.add_argument('--browser-script', default='tests/interface-redesign.e2e.mjs')
parser.add_argument('--evidence-directory', default='interface-redesign')
args = parser.parse_args()
if not args.namespace.startswith('testflow-e2e-'):
    raise SystemExit('An isolated testflow-e2e namespace is required')
target = KubernetesTarget.from_args(args)
existing = json.loads(target.run('get', 'namespaces', '-o', 'json', text=True).stdout)['items']
if any(item['metadata']['name'] == args.namespace for item in existing):
    raise SystemExit('Existing namespace preserved; use a fresh test namespace')
script = (ROOT / args.browser_script).resolve()
if not script.is_relative_to(ROOT / 'tests') or not script.is_file():
    raise SystemExit('Browser script must be a saved file in tests')
if not args.evidence_directory.replace('-', '').isalnum():
    raise SystemExit('Evidence directory must be a simple name')
if args.load_images:
    examples = json.loads((ROOT / '.data/example-modules.json').read_text())
    images = ['testflow-server:dev', 'testflow-web:dev'] + [item['image'] for item in examples]
    if script.name == 'node-configuration.e2e.mjs':
        repository_examples = json.loads((ROOT / 'examples/repository-helpdesk/downloads/index.json').read_text())
        images += [item['image'] for item in repository_examples['modules']]
    load_local_images(target, images)
elif args.load_web_image:
    load_local_images(target, ['testflow-web:dev'])
port = args.port
if not port:
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
output = ROOT / '.data/acceptance' / args.namespace
output.mkdir(parents=True, exist_ok=True)
forward = None
proof = {'namespace': args.namespace, 'context': target.context, 'browser': {}, 'cleanup': {}}
try:
    print('Creating ' + args.namespace, flush=True)
    command = [sys.executable, str(ROOT / 'scripts/deploy-kubernetes.py'), '--namespace', args.namespace, '--port', str(port), '--context', target.context, '--kubeconfig', str(target.kubeconfig), '--kubectl', target.kubectl]
    with (output / 'deployment.log').open('w') as log:
        subprocess.run(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=360)
    print('Deployment ready. Testing actual browser interactions.', flush=True)
    with (output / 'port-forward.log').open('w') as log:
        forward = subprocess.Popen(target.command(args.namespace) + ['port-forward', '--address=127.0.0.1', 'service/testflow-web', f'{port}:8080'], stdout=log, stderr=subprocess.STDOUT)
        result = subprocess.run(['node', str(script)], cwd=ROOT, env={**os.environ, 'TESTFLOW_E2E_NAMESPACE': args.namespace}, capture_output=True, text=True, timeout=540)
        (output / 'browser.log').write_text(result.stdout + result.stderr)
        print(result.stdout, end='', flush=True)
        if result.returncode:
            print(result.stderr[-4500:], flush=True)
            raise RuntimeError('Browser verification failed; evidence preserved at ' + str(output.relative_to(ROOT)))
    report = json.loads((output / args.evidence_directory / 'control-cases.json').read_text())
    proof['browser'] = {'passed': report['passed'], 'cases': len(report['cases']), 'layouts': len(report['layouts']), 'javascript_errors': report['errors']}
finally:
    try:
        trace = output / args.evidence_directory / 'private-trace.zip'
        if trace.exists():
            subprocess.run([sys.executable, str(ROOT / 'scripts/sanitize-browser-trace.py'), str(trace), str(trace.with_name('trace.zip'))], cwd=ROOT, check=True, capture_output=True)
    finally:
        if forward is not None and forward.poll() is None:
            forward.terminate()
            try:
                forward.wait(timeout=10)
            except subprocess.TimeoutExpired:
                forward.kill()
                forward.wait(timeout=10)
        proof['cleanup']['port_forward_stopped'] = True
        print('Reclaiming temporary namespace and volumes.', flush=True)
        target.run('delete', 'namespace', args.namespace, '--ignore-not-found', '--wait=false', text=True)
        deadline = time.monotonic() + 90
        while True:
            namespaces = json.loads(target.run('get', 'namespaces', '-o', 'json', text=True).stdout)['items']
            volumes = json.loads(target.run('get', 'pv', '-o', 'json', text=True).stdout)['items']
            present = any(item['metadata']['name'] == args.namespace for item in namespaces)
            attached = any(item['spec'].get('claimRef', {}).get('namespace') == args.namespace for item in volumes)
            if not present and not attached:
                proof['cleanup']['namespace_and_volumes_deleted'] = True
                break
            if time.monotonic() > deadline:
                raise RuntimeError('Temporary resource cleanup timed out')
            time.sleep(1)
        (output / 'result.json').write_text(json.dumps(proof, ensure_ascii=False, indent=2))

print(json.dumps(proof), flush=True)
