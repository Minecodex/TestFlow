"""Run the supported release integration suites in disposable Kubernetes workspaces."""
import argparse
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import shutil
import socket
import subprocess
import sys
from uuid import uuid4

from kubernetes_support import ROOT, KubernetesTarget, add_cluster_arguments, load_local_images


def run(*arguments, environment=None):
    print('Running ' + ' '.join(map(str, arguments[:3])), flush=True)
    subprocess.run(list(map(str, arguments)), cwd=ROOT, env=environment, check=True)


def python(script, *arguments, environment=None):
    run(sys.executable, ROOT / script, *arguments, environment=environment)


def prepare():
    run('docker', 'build', '-f', 'server/Dockerfile', '-t', 'testflow-server:dev', '.')
    run('docker', 'build', '-f', 'web/Dockerfile', '-t', 'testflow-web:dev', '.')
    run('docker', 'pull', 'postgres:18')
    python('scripts/module-package.py', 'examples', '--version', '1.0.2', '--build')
    python('examples/repository-helpdesk/build.py', '--build')
    prepare_faults()


def prepare_faults():
    source = ROOT / 'tests/fixtures/fault-module'
    fingerprint = hashlib.sha256(b''.join(path.read_bytes() for path in sorted(source.rglob('*'))
                                          if path.is_file())).hexdigest()[:12]
    images = []
    for version in ('1.0.0', '1.0.1', '1.0.2'):
        directory = ROOT / '.data/ci-fixtures' / version
        shutil.copytree(source, directory, dirs_exist_ok=True)
        manifest = json.loads((directory / 'manifest.json').read_text())
        image = f'testflow/fault-module:ci-{version}-{fingerprint}'
        manifest.update(version=version)
        manifest['runtime']['image'] = image
        (directory / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        python('scripts/module-package.py', 'package', directory, '--output',
               ROOT / '.data/module-packages' / f'test-fixture-{version}.zip')
        run('docker', 'build', '-t', image, directory)
        images.append(image)
    (ROOT / '.data/ci-fixtures/images.json').write_text(json.dumps(images) + '\n')


def provider(target, namespace):
    name = 'testflow-eval-fixture'
    source = (ROOT / 'tests/kubernetes/evaluation_fixture.py').read_text()
    items = [
        {'apiVersion': 'v1', 'kind': 'ConfigMap', 'metadata': {'name': name}, 'data': {'provider.py': source}},
        {'apiVersion': 'v1', 'kind': 'Service', 'metadata': {'name': name},
         'spec': {'selector': {'app': name}, 'ports': [{'port': 8080}]}},
        {'apiVersion': 'apps/v1', 'kind': 'Deployment', 'metadata': {'name': name}, 'spec': {
            'replicas': 1, 'selector': {'matchLabels': {'app': name}},
            'template': {'metadata': {'labels': {'app': name}}, 'spec': {
                'automountServiceAccountToken': False,
                'securityContext': {'runAsNonRoot': True, 'runAsUser': 10001},
                'containers': [{'name': 'provider', 'image': 'testflow-server:dev',
                    'imagePullPolicy': 'IfNotPresent', 'command': ['python', '/fixture/provider.py'],
                    'readinessProbe': {'httpGet': {'path': '/health', 'port': 8080}},
                    'resources': {'requests': {'cpu': '20m', 'memory': '32Mi'},
                                  'limits': {'cpu': '200m', 'memory': '128Mi'}},
                    'volumeMounts': [{'name': 'fixture', 'mountPath': '/fixture', 'readOnly': True}]}],
                'volumes': [{'name': 'fixture', 'configMap': {'name': name}}]}}}}]
    target.run('apply', '-f', '-', namespace=namespace, text=True,
               input=json.dumps({'apiVersion': 'v1', 'kind': 'List', 'items': items}))
    target.run('rollout', 'status', 'deployment/' + name, '--timeout=120s', namespace=namespace, text=True)


@contextmanager
def workspace(target, namespace):
    if target.run('get', 'namespace', namespace, '--ignore-not-found', '-o', 'name', text=True).stdout.strip():
        raise RuntimeError('Existing namespace preserved: ' + namespace)
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    forward = None
    try:
        python('scripts/deploy-kubernetes.py', '--namespace', namespace, '--port', port,
               '--context', target.context, '--kubeconfig', target.kubeconfig, '--kubectl', target.kubectl)
        folder = ROOT / '.data/acceptance' / namespace
        folder.mkdir(parents=True, exist_ok=True)
        with (folder / 'port-forward.log').open('w') as log:
            forward = subprocess.Popen(target.command(namespace) + ['port-forward', '--address=127.0.0.1',
                                       'service/testflow-web', f'{port}:8080'], stdout=log, stderr=subprocess.STDOUT)
            yield namespace
    finally:
        if forward is not None:
            forward.terminate()
            try:
                forward.wait(timeout=10)
            except subprocess.TimeoutExpired:
                forward.kill()
                forward.wait(timeout=10)
        if (ROOT / '.data/kubernetes' / namespace / 'access.json').is_file():
            python('scripts/cleanup-acceptance.py', '--namespace', namespace)


def export_evidence(destination, namespaces):
    destination.mkdir(parents=True, exist_ok=True)
    acceptance = ROOT / '.data/acceptance'
    reports = {'result.json', 'control-cases.json', 'trace.zip', 'cleanup.json', 'boundaries.json',
               'reliability.json', 'live-media.json', 'go-protocol.json', 'code-mount.json',
               'transaction-and-media.json', 'restore.json'}
    for namespace in namespaces:
        if not namespace.startswith(('testflow-e2e-', 'testflow-restore-')) or '/' in namespace:
            raise ValueError('Evidence must come from an owned disposable namespace')
        for path in (acceptance / namespace).rglob('*'):
            if path.is_file() and (path.name in reports or path.suffix == '.png'):
                output = destination / path.relative_to(acceptance)
                output.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, output)


def integration(args):
    target = KubernetesTarget.from_args(args)
    if target.context != 'docker-desktop' and not target.context.startswith('kind-testflow-ci-'):
        raise SystemExit('Release tests require Docker Desktop or a disposable testflow-ci kind cluster')
    identity = uuid4().hex[:10]
    connection = ['--context', target.context, '--kubeconfig', target.kubeconfig, '--kubectl', target.kubectl]
    examples = json.loads((ROOT / '.data/example-modules.json').read_text())
    repository = json.loads((ROOT / 'examples/repository-helpdesk/downloads/index.json').read_text())
    faults = json.loads((ROOT / '.data/ci-fixtures/images.json').read_text())
    load_local_images(target, ['testflow-server:dev', 'testflow-web:dev', 'postgres:18',
                              *[row['image'] for row in examples],
                              *[row['image'] for row in repository['modules']], *faults])
    core = 'testflow-e2e-release-' + identity
    restored = 'testflow-restore-release-' + identity
    inputs = 'testflow-e2e-inputs-ci-' + identity
    installation = 'testflow-e2e-install-ci-' + identity
    proof = {'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
             'context': target.context, 'provider_kind': 'contract_fixture', 'suites': [], 'passed': False}
    proof['namespaces'] = [core, restored, inputs, installation]
    evidence = ROOT / '.data/ci-evidence'
    evidence.mkdir(parents=True, exist_ok=True)
    try:
        python('tests/container-smoke.py')
        proof['suites'].append('container_runtime_and_proxy')
        with workspace(target, core):
            provider(target, core)
            key = evidence / 'fixture-credential'
            key.write_text('ci-contract-provider')
            key.chmod(0o600)
            try:
                python('tests/kubernetes/acceptance.py', '--namespace', core,
                       '--evaluation-endpoint', 'http://testflow-eval-fixture:8080',
                       '--evaluation-credential-file', key)
            finally:
                key.unlink(missing_ok=True)
            proof['suites'].append('cross_language_tasks_scoring_and_history')
            for suite in ('live_media', 'go_protocol', 'code_mount', 'transaction_and_media', 'boundaries', 'reliability'):
                python('tests/kubernetes/' + suite + '.py', '--namespace', core)
                proof['suites'].append(suite)
            backup = ROOT / '.data/ci-backup' / identity
            python('scripts/backup-kubernetes.py', '--namespace', core, '--output', backup)
            with workspace(target, restored):
                provider(target, restored)
                python('scripts/restore-kubernetes.py', '--namespace', restored, '--backup', backup)
                target.run('rollout', 'status', 'deployment/testflow-server', '--timeout=120s',
                           namespace=restored, text=True)
                python('tests/kubernetes/backup_restore.py', '--namespace', restored, '--source', core)
                proof['suites'].append('backup_restore_and_encrypted_scoring_credentials')
        python('tests/kubernetes/input_only.py', '--namespace', inputs, *connection)
        proof['suites'].append('input_groups_and_model_protocol_browser')
        python('tests/kubernetes/beta_installation.py', '--namespace', installation,
               '--local-platform-images', '--server-image', 'testflow-server:dev',
               '--web-image', 'testflow-web:dev', *connection)
        proof['suites'].append('single_apply_and_node_configuration_browser')
        proof['passed'] = True
    finally:
        export_evidence(evidence / 'acceptance', proof['namespaces'])
        (evidence / 'release-result.json').write_text(json.dumps(proof, ensure_ascii=False, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    add_cluster_arguments(parser)
    parser.add_argument('phase', choices=('prepare', 'integration', 'evidence'))
    args = parser.parse_args()
    if args.phase == 'prepare':
        prepare()
    elif args.phase == 'integration':
        integration(args)
    else:
        result = ROOT / '.data/ci-evidence/release-result.json'
        if result.is_file():
            proof = json.loads(result.read_text())
            export_evidence(result.parent / 'acceptance', proof['namespaces'])


if __name__ == '__main__':
    main()
