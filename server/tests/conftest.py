import asyncio
import os
from pathlib import Path
import sys

import httpx
import pytest_asyncio
from argon2 import PasswordHasher
from cryptography.fernet import Fernet
from pydantic import SecretStr
from sqlalchemy import text

from testflow.core.config import Settings
from testflow.infrastructure.database import Base
from testflow.main import create_app


def report_async_tasks():
    """Expose coroutine wait locations alongside faulthandler's thread stacks."""
    for task in asyncio.all_tasks():
        print(f'\nAsync task: {task.get_name()}', file=sys.stderr, flush=True)
        coroutine = task.get_coro()
        while coroutine is not None:
            frame = getattr(coroutine, 'cr_frame', getattr(coroutine, 'gi_frame', None))
            if frame is not None:
                print(f'  {frame.f_code.co_filename}:{frame.f_lineno} in {frame.f_code.co_name}',
                      file=sys.stderr, flush=True)
            coroutine = getattr(coroutine, 'cr_await', getattr(coroutine, 'gi_yieldfrom', None))


@pytest_asyncio.fixture(autouse=True)
async def async_wait_diagnostics(request):
    seconds = float(request.config.getini('faulthandler_timeout'))
    handle = asyncio.get_running_loop().call_later(seconds, report_async_tasks) if seconds > 0 else None
    try:
        yield
    finally:
        if handle is not None:
            handle.cancel()


@pytest_asyncio.fixture
async def app_client(tmp_path: Path):
    database_url = os.environ.get('TESTFLOW_TEST_DATABASE_URL', 'sqlite+aiosqlite:///' + str(tmp_path/'test.sqlite'))
    if database_url.startswith('postgresql'):
        from sqlalchemy.engine import make_url
        if not make_url(database_url).database.endswith('_test'):
            raise RuntimeError('Destructive tests require a database name ending in _test')
    settings = Settings(environment='test', data_dir=tmp_path, database_url=SecretStr(database_url),
        admin_password_hash=SecretStr(PasswordHasher().hash('test-password')), encryption_key=SecretStr(Fernet.generate_key().decode()),
        scheduler_enabled=False, allow_local_images=True, _env_file=None)
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        async with app.state.database.engine.begin() as connection:
            await connection.run_sync(Base.metadata.drop_all)
            await connection.run_sync(Base.metadata.create_all)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            result=await client.post('/api/v1/auth/login',json={'username':'admin','password':'test-password'})
            assert result.status_code==200,result.text
            yield app, client
