"""Create a namespaced TestFlow installation in an explicit Kubernetes context."""
import argparse
import json
import secrets
from urllib.parse import quote

from argon2 import PasswordHasher
from cryptography.fernet import Fernet
import yaml

from kubernetes_support import ROOT, KubernetesTarget, add_cluster_arguments, load_local_images

parser = argparse.ArgumentParser()
add_cluster_arguments(parser)
parser.add_argument('--namespace', required=True)
parser.add_argument('--port', type=int, default=18765)
parser.add_argument('--load-images', action='store_true')
args = parser.parse_args()
if not args.namespace.startswith('testflow-'):
    raise SystemExit('Namespace must start with testflow-')
target = KubernetesTarget.from_args(args)


def run(*command, input=None):
    return target.run(*command, namespace=args.namespace, input=input, text=True).stdout


existing = json.loads(run('get', 'namespaces', '-o', 'json'))['items']
if any(item['metadata']['name'] == args.namespace for item in existing):
    raise SystemExit('Existing namespace preserved; choose a new namespace')
rendered = target.run('kustomize', str(ROOT / 'deploy/k8s/base'), text=True).stdout
resources = list(yaml.safe_load_all(rendered))
for resource in resources:
    resource['metadata']['namespace'] = args.namespace
    if resource['kind'] == 'ConfigMap':
        resource['data'].update(TESTFLOW_ENVIRONMENT='development',
                                TESTFLOW_PUBLIC_URL=f'http://127.0.0.1:{args.port}',
                                TESTFLOW_ALLOW_LOCAL_IMAGES='true', TESTFLOW_COOKIE_SECURE='false')
    for container in resource.get('spec', {}).get('template', {}).get('spec', {}).get('containers', []):
        if container['image'].startswith('testflow-'):
            container['image'] = container['image'].split(':')[0] + ':dev'
if args.load_images:
    examples = json.loads((ROOT / '.data/example-modules.json').read_text())
    load_local_images(target, ['testflow-server:dev', 'testflow-web:dev', 'postgres:18'] +
                      [item['image'] for item in examples])
output = ROOT / '.data/kubernetes' / args.namespace
output.mkdir(parents=True, exist_ok=True)
password = secrets.token_urlsafe(20)
db_password = secrets.token_urlsafe(24)
key = Fernet.generate_key().decode()
secret = {'apiVersion': 'v1', 'kind': 'Secret',
          'metadata': {'name': 'testflow-secrets', 'namespace': args.namespace}, 'type': 'Opaque',
          'stringData': {
              'TESTFLOW_DATABASE_URL': f'postgresql+asyncpg://testflow:{quote(db_password)}@testflow-postgres:5432/testflow',
              'TESTFLOW_ADMIN_PASSWORD_HASH': PasswordHasher().hash(password), 'TESTFLOW_ENCRYPTION_KEY': key}}
postgres = {'apiVersion': 'v1', 'kind': 'Secret',
            'metadata': {'name': 'testflow-postgres-secret', 'namespace': args.namespace},
            'type': 'Opaque', 'stringData': {'password': db_password}}
namespace = {'apiVersion': 'v1', 'kind': 'Namespace', 'metadata': {'name': args.namespace, 'labels': {
    'app.kubernetes.io/part-of': 'testflow',
    'testflow-acceptance': 'true' if args.namespace.startswith(('testflow-e2e-', 'testflow-restore-')) else 'false'}}}
access = {'namespace': args.namespace, **target.access_fields(), 'url': f'http://127.0.0.1:{args.port}',
          'username': 'admin', 'password': password, 'encryption_key': key, 'port': args.port}
file = output / 'access.json'
file.write_text(json.dumps(access, indent=2))
file.chmod(0o600)
password_file = output / 'admin-initial-password'
password_file.write_text(password + '\n')
password_file.chmod(0o600)
prerequisites = [item for item in resources if item['kind'] not in {'Deployment', 'Job'}]
print(run('apply', '-f', '-', input=json.dumps({'apiVersion': 'v1', 'kind': 'List',
                                              'items': [namespace, secret, postgres, *prerequisites]})), flush=True)
print(run('rollout', 'status', 'statefulset/testflow-postgres', '--timeout=120s'), flush=True)
for job in (item for item in resources if item['kind'] == 'Job'):
    print(run('apply', '-f', '-', input=json.dumps(job)), flush=True)
    print(run('wait', '--for=condition=complete', 'job/' + job['metadata']['name'], '--timeout=120s'), flush=True)
print(run('apply', '-f', '-', input=json.dumps({'apiVersion': 'v1', 'kind': 'List',
                                              'items': [item for item in resources if item['kind'] == 'Deployment']})), flush=True)
for deployment in ('testflow-server', 'testflow-web'):
    print(run('rollout', 'status', 'deployment/' + deployment, '--timeout=120s'), flush=True)
(output / 'manifest.yaml').write_text(yaml.safe_dump_all(resources))
print('Private installation access:', file.relative_to(ROOT))
print(f'Cluster context: {target.context}; namespace: {args.namespace}')
