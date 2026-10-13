"""Maintain the static directory consumed by kubectl apply -f."""
import argparse
from pathlib import Path
import re

import yaml

from kubernetes_installation import configure_resources, load_base_resources

ROOT = Path(__file__).resolve().parents[1]


class ManifestDumper(yaml.SafeDumper):
    pass


def represent_text(dumper, value):
    return dumper.represent_scalar('tag:yaml.org,2002:str', value,
                                   style='|' if '\n' in value else None)


ManifestDumper.add_representer(str, represent_text)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--namespace', default='testflow')
parser.add_argument('--port', type=int, default=18765)
parser.add_argument('--server-image', default='kakj/testflow-server:v0.0.1-beta')
parser.add_argument('--web-image', default='kakj/testflow-web:v0.0.1-beta')
parser.add_argument('--output', type=Path, default=ROOT / 'deploy/k8s/beta')
parser.add_argument('--check', action='store_true')
args = parser.parse_args()
version = args.server_image.rsplit(':', 1)[-1]
job_suffix = re.sub(r'[^a-z0-9-]+', '-', version.lower()).strip('-')[:24]
resources = configure_resources(load_base_resources(ROOT / 'deploy/k8s/base'), args.namespace,
                                args.server_image, args.web_image, args.port)
metadata = lambda name: {'name': name, 'namespace': args.namespace}
volume = {'name': 'bootstrap', 'configMap': {'name': 'testflow-bootstrap-code'}}
mount = {'name': 'bootstrap', 'mountPath': '/bootstrap', 'readOnly': True}
security = {'allowPrivilegeEscalation': False, 'readOnlyRootFilesystem': True,
            'capabilities': {'drop': ['ALL']}}


def gate(name, action, secrets=False):
    container = {'name': name, 'image': args.server_image, 'imagePullPolicy': 'IfNotPresent',
                 'command': ['python', '/bootstrap/bootstrap.py', action], 'securityContext': security,
                 'resources': {'requests': {'cpu': '25m', 'memory': '32Mi'},
                               'limits': {'cpu': '500m', 'memory': '256Mi'}}, 'volumeMounts': [mount]}
    if secrets:
        container['envFrom'] = [{'secretRef': {'name': 'testflow-secrets'}}]
    return container


for resource in resources:
    if resource['kind'] not in {'Deployment', 'Job'}:
        continue
    pod = resource['spec']['template']['spec']
    if resource['metadata']['name'] == 'testflow-migrate':
        pod['initContainers'] = [gate('wait-postgres', 'wait-database', secrets=True)]
        resource['metadata']['name'] += '-' + job_suffix
    elif resource['metadata']['name'] == 'testflow-server':
        pod['initContainers'] = [gate('wait-migration', 'wait-schema', secrets=True)]
    elif resource['metadata']['name'] == 'testflow-web':
        pod['initContainers'] = [gate('wait-backend', 'wait-backend')]
    pod.setdefault('volumes', []).append(volume)

bootstrap = {'apiVersion': 'batch/v1', 'kind': 'Job', 'metadata': metadata('testflow-bootstrap-' + job_suffix),
             'spec': {'backoffLimit': 6, 'template': {'metadata': {'labels': {'app': 'testflow-bootstrap'}},
                 'spec': {'serviceAccountName': 'testflow-bootstrap', 'restartPolicy': 'OnFailure',
                          'automountServiceAccountToken': True,
                          'securityContext': {'runAsNonRoot': True, 'runAsUser': 10001,
                                              'seccompProfile': {'type': 'RuntimeDefault'}},
                          'containers': [{**gate('bootstrap', 'bootstrap'), 'env': [
                              {'name': 'TESTFLOW_NAMESPACE', 'valueFrom': {'fieldRef': {'fieldPath': 'metadata.namespace'}}}]}],
                          'volumes': [volume]}}}}
bootstrap_roles = [
    {'apiVersion': 'v1', 'kind': 'ServiceAccount', 'metadata': metadata('testflow-bootstrap')},
    {'apiVersion': 'rbac.authorization.k8s.io/v1', 'kind': 'Role', 'metadata': metadata('testflow-bootstrap'),
     'rules': [{'apiGroups': [''], 'resources': ['secrets'], 'verbs': ['get'],
                'resourceNames': ['testflow-secrets', 'testflow-postgres-secret']},
               {'apiGroups': [''], 'resources': ['secrets'], 'verbs': ['create']}]},
    {'apiVersion': 'rbac.authorization.k8s.io/v1', 'kind': 'RoleBinding', 'metadata': metadata('testflow-bootstrap'),
     'subjects': [{'kind': 'ServiceAccount', 'name': 'testflow-bootstrap', 'namespace': args.namespace}],
     'roleRef': {'apiGroup': 'rbac.authorization.k8s.io', 'kind': 'Role', 'name': 'testflow-bootstrap'}}]
files = {
    '00-namespace.yaml': [{'apiVersion': 'v1', 'kind': 'Namespace', 'metadata': {
        'name': args.namespace, 'labels': {'app.kubernetes.io/part-of': 'testflow',
        'testflow-acceptance': 'true' if args.namespace.startswith('testflow-e2e-') else 'false'}}}],
    '01-config.yaml': [resource for resource in resources if resource['kind'] == 'ConfigMap'] + [
        {'apiVersion': 'v1', 'kind': 'ConfigMap', 'metadata': metadata('testflow-bootstrap-code'),
         'data': {'bootstrap.py': (ROOT / 'scripts/kubernetes_bootstrap.py').read_text(),
                  'kubernetes_installation.py': (ROOT / 'scripts/kubernetes_installation.py').read_text()}}],
    '02-rbac.yaml': [resource for resource in resources if resource['kind'] in {'ServiceAccount', 'Role', 'RoleBinding'}] + bootstrap_roles,
    '03-bootstrap.yaml': [bootstrap],
    '04-storage.yaml': [resource for resource in resources if resource['kind'] == 'PersistentVolumeClaim'],
    '05-postgres.yaml': [resource for resource in resources if resource['kind'] == 'StatefulSet' or resource['metadata']['name'] == 'testflow-postgres'],
    '06-migration.yaml': [resource for resource in resources if resource['kind'] == 'Job'],
    '07-server.yaml': [resource for resource in resources if resource['metadata']['name'] == 'testflow-server' and resource['kind'] in {'Deployment', 'Service'}],
    '08-web.yaml': [resource for resource in resources if resource['metadata']['name'] == 'testflow-web']}
args.output.mkdir(parents=True, exist_ok=True)
errors = []
for filename, documents in files.items():
    text = yaml.dump_all(documents, Dumper=ManifestDumper, sort_keys=False)
    path = args.output / filename
    if args.check:
        if not path.is_file() or path.read_text() != text:
            errors.append(filename)
    else:
        path.write_text(text)
if errors:
    raise SystemExit('Static deployment directory is out of date: ' + ', '.join(errors))
print('Checked' if args.check else 'Exported', len(files), 'declarative manifests')
