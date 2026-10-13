"""Create a namespaced TestFlow installation in an explicit Kubernetes context."""
import argparse
import json
import yaml

from kubernetes_installation import create_installation
from kubernetes_support import ROOT, KubernetesTarget, add_cluster_arguments, load_local_images

parser = argparse.ArgumentParser()
add_cluster_arguments(parser)
parser.add_argument('--namespace', required=True)
parser.add_argument('--port', type=int, default=18765)
parser.add_argument('--server-image', default='testflow-server:dev',
                    help='Backend and migration image (default: testflow-server:dev)')
parser.add_argument('--web-image', default='testflow-web:dev',
                    help='Web image (default: testflow-web:dev)')
parser.add_argument('--load-images', action='store_true')
args = parser.parse_args()
if args.namespace != 'testflow' and not args.namespace.startswith('testflow-'):
    raise SystemExit('Namespace must be testflow or start with testflow-')
platform_images = {'testflow-server': args.server_image, 'testflow-web': args.web_image}
if any(not image or any(char.isspace() for char in image) for image in platform_images.values()):
    parser.error('Platform images must be non-empty image references without whitespace')
target = KubernetesTarget.from_args(args)


def run(*command, input=None):
    return target.run(*command, namespace=args.namespace, input=input, text=True).stdout


existing = json.loads(run('get', 'namespaces', '-o', 'json'))['items']
if any(item['metadata']['name'] == args.namespace for item in existing):
    raise SystemExit('Existing namespace preserved; choose a new namespace')
rendered = target.run('kustomize', str(ROOT / 'deploy/k8s/base'), text=True).stdout
try:
    installation = create_installation(list(yaml.safe_load_all(rendered)), args.namespace,
                                       args.server_image, args.web_image, args.port)
except ValueError as error:
    parser.error(str(error))
resources = installation.resources
if args.load_images:
    examples = json.loads((ROOT / '.data/example-modules.json').read_text())
    load_local_images(target, [*platform_images.values(), 'postgres:18'] +
                      [item['image'] for item in examples])
output = ROOT / '.data/kubernetes' / args.namespace
output.mkdir(parents=True, exist_ok=True)
password = installation.password
key = installation.encryption_key
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
                                              'items': [installation.namespace, *installation.secrets,
                                                        *prerequisites]})), flush=True)
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
