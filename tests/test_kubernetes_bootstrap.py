import base64
from copy import deepcopy
from pathlib import Path
import sys
from types import SimpleNamespace
from urllib.parse import quote

from argon2 import PasswordHasher
from cryptography.fernet import Fernet
from kubernetes_asyncio.client.exceptions import ApiException
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from kubernetes_bootstrap import ensure_bootstrap_secrets, secret_value


class SecretsAPI:
    def __init__(self):
        self.rows = {}
        self.failed_platform_create = False
        self.concurrent_postgres = None

    async def read_namespaced_secret(self, name, namespace):
        if name not in self.rows:
            raise ApiException(status=404)
        return SimpleNamespace(data=deepcopy(self.rows[name]))

    async def create_namespaced_secret(self, namespace, body):
        assert body['metadata']['namespace'] == namespace
        name = body['metadata']['name']
        if self.failed_platform_create and name == 'testflow-secrets':
            self.failed_platform_create = False
            raise ApiException(status=503)
        if self.concurrent_postgres and name == 'testflow-postgres-secret':
            password, self.concurrent_postgres = self.concurrent_postgres, None
            self.rows[name] = {'password': base64.b64encode(password.encode()).decode()}
        if name in self.rows:
            raise ApiException(status=409)
        self.rows[name] = {key: base64.b64encode(value.encode()).decode()
                           for key, value in body['stringData'].items()}
        return await self.read_namespaced_secret(name, namespace)


async def assert_consistent(api, namespace='testflow-test'):
    platform = await api.read_namespaced_secret('testflow-secrets', namespace)
    postgres = await api.read_namespaced_secret('testflow-postgres-secret', namespace)
    password = secret_value(postgres, 'password')
    assert secret_value(platform, 'TESTFLOW_DATABASE_URL') == (
        f'postgresql+asyncpg://testflow:{quote(password)}@testflow-postgres:5432/testflow')
    assert PasswordHasher().verify(secret_value(platform, 'TESTFLOW_ADMIN_PASSWORD_HASH'), '123456')
    Fernet(secret_value(platform, 'TESTFLOW_ENCRYPTION_KEY').encode())


@pytest.mark.asyncio
@pytest.mark.parametrize('namespace', ['testflow', 'testflow-test'])
async def test_first_bootstrap_and_retry_preserve_private_configuration(namespace):
    api = SecretsAPI()
    await ensure_bootstrap_secrets(api, namespace)
    await assert_consistent(api, namespace)
    initial = deepcopy(api.rows)
    await ensure_bootstrap_secrets(api, namespace)
    assert api.rows == initial
    second = SecretsAPI()
    await ensure_bootstrap_secrets(second, 'testflow-other')
    assert second.rows['testflow-secrets']['TESTFLOW_ENCRYPTION_KEY'] != initial['testflow-secrets']['TESTFLOW_ENCRYPTION_KEY']


@pytest.mark.asyncio
async def test_interrupted_bootstrap_reuses_persisted_database_password():
    api = SecretsAPI()
    api.failed_platform_create = True
    with pytest.raises(ApiException):
        await ensure_bootstrap_secrets(api, 'testflow-test')
    initial = deepcopy(api.rows['testflow-postgres-secret'])
    await ensure_bootstrap_secrets(api, 'testflow-test')
    assert api.rows['testflow-postgres-secret'] == initial
    await assert_consistent(api)


@pytest.mark.asyncio
async def test_concurrent_bootstrap_uses_the_winning_secret():
    api = SecretsAPI()
    api.concurrent_postgres = 'concurrent-database-password'
    await ensure_bootstrap_secrets(api, 'testflow-test')
    await assert_consistent(api)


@pytest.mark.asyncio
async def test_missing_postgres_secret_is_restored_from_existing_platform_secret():
    api = SecretsAPI()
    await ensure_bootstrap_secrets(api, 'testflow-test')
    initial = deepcopy(api.rows)
    del api.rows['testflow-postgres-secret']
    await ensure_bootstrap_secrets(api, 'testflow-test')
    assert api.rows == initial


@pytest.mark.asyncio
async def test_inconsistent_existing_secrets_are_not_overwritten():
    api = SecretsAPI()
    await ensure_bootstrap_secrets(api, 'testflow-test')
    api.rows['testflow-postgres-secret']['password'] = base64.b64encode(b'inconsistent-password').decode()
    initial = deepcopy(api.rows)
    with pytest.raises(RuntimeError, match='inconsistent database credentials'):
        await ensure_bootstrap_secrets(api, 'testflow-test')
    assert api.rows == initial
