"""Explicit Kubernetes connections shared by deployment and acceptance tooling."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
DOCKER_KUBECTL = Path('/Applications/Docker.app/Contents/Resources/bin/kubectl')


def add_cluster_arguments(parser):
    parser.add_argument('--context')
    parser.add_argument('--kubeconfig', type=Path)
    parser.add_argument('--kubectl')


class KubernetesTarget:
    def __init__(self, context='docker-desktop', kubeconfig=None, kubectl=None):
        self.context = context
        self.kubeconfig = Path(kubeconfig or Path.home() / '.kube/config').expanduser().resolve()
        self.kubectl = kubectl or (
            str(DOCKER_KUBECTL) if context == 'docker-desktop' and DOCKER_KUBECTL.exists()
            else shutil.which('kubectl')
        )
        if not self.context or not self.kubectl:
            raise SystemExit('An explicit Kubernetes context and kubectl are required')
        self.environment = {**os.environ, 'KUBECONFIG': str(self.kubeconfig)}

    @classmethod
    def from_args(cls, args):
        return cls(args.context or 'docker-desktop', args.kubeconfig, args.kubectl)

    @classmethod
    def from_access(cls, access):
        return cls(access['context'], access['kubeconfig'], access.get('kubectl'))

    def command(self, namespace=None):
        command = [self.kubectl, '--kubeconfig=' + str(self.kubeconfig), '--context=' + self.context]
        return command + ['-n', namespace] if namespace else command

    def access_fields(self):
        return {'context': self.context, 'kubeconfig': str(self.kubeconfig), 'kubectl': self.kubectl}

    def run(self, *command, namespace=None, **kwargs):
        return subprocess.run(self.command(namespace) + list(command), env=self.environment,
                              check=True, capture_output=True, **kwargs)


def namespace_target(namespace, args):
    access = json.loads((ROOT / '.data/kubernetes' / namespace / 'access.json').read_text())
    return KubernetesTarget(args.context or access['context'], args.kubeconfig or access['kubeconfig'],
                            args.kubectl or access.get('kubectl'))


def kube_connection(access, namespace=None):
    target = KubernetesTarget.from_access(access)
    return target.command(namespace), target.environment


def desktop_kind_nodes(target):
    if target.context != 'docker-desktop':
        raise SystemExit('Local image loading requires Docker Desktop; use a registry for other clusters')
    nodes = json.loads(target.run('get', 'nodes', '-o', 'json', text=True).stdout)['items']
    if not nodes:
        raise SystemExit('Docker Desktop has no Kubernetes nodes')
    if all(node['spec'].get('providerID', '').startswith('kind://docker/desktop/') for node in nodes):
        return nodes
    if any(node['spec'].get('providerID', '').startswith('kind://') for node in nodes):
        raise SystemExit('Refusing to import images into an unrecognized kind cluster')
    return []  # Docker Desktop kubeadm uses the shared Docker image store.


def load_local_images(target, images):
    """Stream local images to every Desktop kind node, including replacement tags."""
    images = list(dict.fromkeys(images))
    subprocess.run(['docker', 'image', 'inspect', *images], check=True, capture_output=True)
    for node in desktop_kind_nodes(target):
        name = node['metadata']['name']
        info = node['status']['nodeInfo']
        platform = info['operatingSystem'] + '/' + info['architecture']
        with tempfile.TemporaryFile() as errors:
            export = subprocess.Popen(['docker', 'image', 'save', *images], stdout=subprocess.PIPE,
                                      stderr=errors)
            try:
                subprocess.run(['docker', 'exec', '-i', name, 'ctr', '-n', 'k8s.io', 'images',
                                'import', '--platform=' + platform, '-'], stdin=export.stdout,
                               check=True, capture_output=True)
            finally:
                export.stdout.close()
                status = export.wait()
            if status:
                errors.seek(0)
                raise RuntimeError('Docker image export failed: ' + errors.read().decode()[-1000:])
        print(f'Loaded {len(images)} local images into {name}', flush=True)


def remove_local_images(target, images):
    references = ['docker.io/' + ('library/' if '/' not in image else '') + image for image in images]
    for node in desktop_kind_nodes(target):
        subprocess.run(['docker', 'exec', node['metadata']['name'], 'ctr', '-n', 'k8s.io',
                        'images', 'rm', *references], check=True, capture_output=True)
