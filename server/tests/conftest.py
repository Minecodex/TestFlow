import os
from pathlib import Path

import httpx
import pytest_asyncio
from argon2 import PasswordHasher
from cryptography.fernet import Fernet
from pydantic import SecretStr
from sqlalchemy import text

from testflow.core.config import Settings
from testflow.infrastructure.database import Base
from testflow.main import create_app

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
