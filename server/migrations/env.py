import asyncio
from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine
from testflow.core.config import Settings
from testflow.infrastructure.database import Base
import testflow.infrastructure.models

config = Settings()
if not config.database_url:
    raise RuntimeError('TESTFLOW_DATABASE_URL is required')

def migrate(connection):
    context.configure(connection=connection, target_metadata=Base.metadata)
    with context.begin_transaction():
        context.run_migrations()

async def online():
    engine = create_async_engine(config.database_url.get_secret_value())
    async with engine.connect() as connection:
        await connection.run_sync(migrate)
    await engine.dispose()

if context.is_offline_mode():
    context.configure(url=config.database_url.get_secret_value(), target_metadata=Base.metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    asyncio.run(online())
