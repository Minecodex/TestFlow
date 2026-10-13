"""Render the shared platform resources and private bootstrap configuration."""
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
import re
import secrets
from urllib.parse import quote

from argon2 import PasswordHasher
from cryptography.fernet import Fernet
import yaml


@dataclass
class Installation:
    namespace: dict
    secrets: list[dict]
    resources: list[dict]
    password: str
    encryption_key: str

    def manifest(self):
        return {'apiVersion': 'v1', 'kind': 'List',
                'items': [self.namespace, *self.secrets, *self.resources]}


def load_base_resources(directory: Path):
    """Read the static base also used by the cluster deployment command."""
    definition = yaml.safe_load((directory / 'kustomization.yaml').read_text())
    if set(definition) - {'apiVersion', 'kind', 'resources'}:
        raise ValueError('Image installer requires a static Kubernetes base')
    return [resource for filename in definition['resources']
            for resource in yaml.safe_load_all((directory / filename).read_text()) if resource]


def configure_resources(resources, namespace, server_image, web_image, port):
    if len(namespace) > 63 or not re.fullmatch(r'testflow(?:-[a-z0-9](?:[-a-z0-9]*[a-z0-9])?)?', namespace):
        raise ValueError('Namespace must be testflow or a valid testflow- Kubernetes namespace')
    if not 1 <= port <= 65535:
        raise ValueError('Port must be between 1 and 65535')
    images = {'testflow-server': server_image, 'testflow-web': web_image}
    if any(not image or any(char.isspace() for char in image) for image in images.values()):
        raise ValueError('Platform images must be non-empty image references without whitespace')
    resources = deepcopy(resources)
    for resource in resources:
        resource['metadata']['namespace'] = namespace
        if resource['kind'] == 'RoleBinding':
            for subject in resource['subjects']:
                if subject['kind'] == 'ServiceAccount':
                    subject['namespace'] = namespace
        if resource['kind'] == 'ConfigMap':
            resource['data'].update(TESTFLOW_ENVIRONMENT='development',
                                    TESTFLOW_PUBLIC_URL=f'http://127.0.0.1:{port}',
                                    TESTFLOW_ALLOW_LOCAL_IMAGES='true', TESTFLOW_COOKIE_SECURE='false')
        for container in resource.get('spec', {}).get('template', {}).get('spec', {}).get('containers', []):
            image = container['image'].split(':')[0]
            if image in images:
                container['image'] = images[image]
    return resources


def create_installation(resources, namespace, server_image, web_image, port):
    resources = configure_resources(resources, namespace, server_image, web_image, port)
    password = '123456'
    database_password = secrets.token_urlsafe(24)
    encryption_key = Fernet.generate_key().decode()
    platform_secret = {
        'apiVersion': 'v1', 'kind': 'Secret', 'type': 'Opaque',
        'metadata': {'name': 'testflow-secrets', 'namespace': namespace},
        'stringData': {
            'TESTFLOW_DATABASE_URL': f'postgresql+asyncpg://testflow:{quote(database_password)}@testflow-postgres:5432/testflow',
            'TESTFLOW_ADMIN_PASSWORD_HASH': PasswordHasher().hash(password),
            'TESTFLOW_ENCRYPTION_KEY': encryption_key}}
    postgres_secret = {
        'apiVersion': 'v1', 'kind': 'Secret', 'type': 'Opaque',
        'metadata': {'name': 'testflow-postgres-secret', 'namespace': namespace},
        'stringData': {'password': database_password}}
    namespace_resource = {'apiVersion': 'v1', 'kind': 'Namespace', 'metadata': {
        'name': namespace, 'labels': {
            'app.kubernetes.io/part-of': 'testflow',
            'testflow-acceptance': 'true' if namespace.startswith(('testflow-e2e-', 'testflow-restore-')) else 'false'}}}
    return Installation(namespace_resource, [platform_secret, postgres_secret], resources,
                        password, encryption_key)
