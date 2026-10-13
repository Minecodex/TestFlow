"""Cluster bootstrap and dependency gates used by the declarative Beta manifests."""
import asyncio
import base64
import os
from pathlib import Path
import sys
import time
from urllib.parse import unquote, urlsplit, quote


def secret_value(secret, key):
    try:
        return base64.b64decode(secret.data[key], validate=True).decode()
    except (KeyError, ValueError, TypeError):
        raise RuntimeError('Existing bootstrap Secret is missing valid configuration') from None


def database_password(secret):
    url = urlsplit(secret_value(secret, 'TESTFLOW_DATABASE_URL'))
    if url.hostname != 'testflow-postgres' or url.username != 'testflow' or not url.password:
        raise RuntimeError('Existing bootstrap database URL is not the bundled PostgreSQL')
    return unquote(url.password)


async def ensure_bootstrap_secrets(api, namespace):
    from kubernetes_asyncio.client.exceptions import ApiException
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from kubernetes_installation import create_installation

    async def read(name):
        try:
            return await api.read_namespaced_secret(name, namespace)
        except ApiException as error:
            if error.status == 404:
                return None
            raise

    async def create(body):
        try:
            return await api.create_namespaced_secret(namespace, body)
        except ApiException as error:
            if error.status == 409:
                return await read(body['metadata']['name'])
            raise

    platform = await read('testflow-secrets')
    postgres = await read('testflow-postgres-secret')
    candidate = None
    if not platform or not postgres:
        candidate = create_installation([], namespace, 'server:bootstrap', 'web:bootstrap', 18765)
    if not postgres:
        body = candidate.secrets[1]
        if platform:
            body['stringData']['password'] = database_password(platform)
        postgres = await create(body)
    password = secret_value(postgres, 'password')
    if not platform:
        body = candidate.secrets[0]
        body['stringData']['TESTFLOW_DATABASE_URL'] = (
            f'postgresql+asyncpg://testflow:{quote(password)}@testflow-postgres:5432/testflow')
        platform = await create(body)
    if database_password(platform) != password:
        raise RuntimeError('Existing bootstrap Secrets have inconsistent database credentials')
    for key in ('TESTFLOW_ADMIN_PASSWORD_HASH', 'TESTFLOW_ENCRYPTION_KEY'):
        if not secret_value(platform, key):
            raise RuntimeError('Existing bootstrap Secret has incomplete configuration')
    print('Bootstrap Secrets ready; existing configuration preserved', flush=True)


async def bootstrap():
    from kubernetes_asyncio import client, config
    from kubernetes_asyncio.client.exceptions import ApiException
    config.load_incluster_config()
    deadline = time.monotonic() + 300
    async with client.ApiClient() as api_client:
        api = client.CoreV1Api(api_client)
        while True:
            try:
                await ensure_bootstrap_secrets(api, os.environ['TESTFLOW_NAMESPACE'])
                return
            except ApiException as error:
                if error.status not in {403, 429, 500, 502, 503, 504} or time.monotonic() >= deadline:
                    raise RuntimeError(f'Bootstrap Kubernetes API failed ({error.status})') from None
                await asyncio.sleep(2)


async def wait_database(schema=False):
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine
    heads = None
    if schema:
        from alembic.config import Config
        from alembic.script import ScriptDirectory
        heads = set(ScriptDirectory.from_config(Config('/app/alembic.ini')).get_heads())
    engine = create_async_engine(os.environ['TESTFLOW_DATABASE_URL'],
                                 connect_args={'timeout': 3, 'command_timeout': 3})
    deadline = time.monotonic() + 300
    try:
        while True:
            try:
                async with engine.connect() as connection:
                    if heads is None:
                        await connection.execute(text('SELECT 1'))
                    else:
                        rows = (await connection.execute(text('SELECT version_num FROM alembic_version'))).scalars()
                        if set(rows) != heads:
                            raise RuntimeError('Migration is pending')
                print('Database schema ready' if schema else 'Database ready', flush=True)
                return
            except Exception:
                if time.monotonic() >= deadline:
                    raise RuntimeError('Database dependency did not become ready') from None
                await asyncio.sleep(2)
    finally:
        await engine.dispose()


async def wait_backend():
    from urllib.request import urlopen
    def ready():
        with urlopen('http://testflow-server:8000/health/ready', timeout=3) as response:
            return response.status == 200
    deadline = time.monotonic() + 300
    while True:
        try:
            if await asyncio.to_thread(ready):
                print('Backend ready', flush=True)
                return
        except Exception:
            pass
        if time.monotonic() >= deadline:
            raise RuntimeError('Backend did not become ready')
        await asyncio.sleep(2)


async def main():
    action = sys.argv[1] if len(sys.argv) > 1 else 'bootstrap'
    if action == 'bootstrap':
        await bootstrap()
    elif action in {'wait-database', 'wait-schema'}:
        await wait_database(schema=action == 'wait-schema')
    elif action == 'wait-backend':
        await wait_backend()
    else:
        raise SystemExit('Unknown bootstrap action')


if __name__ == '__main__':
    asyncio.run(main())
