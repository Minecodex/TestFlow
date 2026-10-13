from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from testflow.core.config import Settings


class Base(DeclarativeBase):
    pass


class Database:
    """Optional during bootstrap; every concurrent operation gets its own session."""

    def __init__(self, settings: Settings) -> None:
        url = settings.database_url.get_secret_value() if settings.database_url else ""
        options = {"connect_args": {"timeout": 3, "command_timeout": 10}, "pool_timeout": 3} if url.startswith("postgresql") else {}
        self.engine = (
            create_async_engine(url, pool_pre_ping=True, **options)
            if settings.database_url else None
        )
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False) if self.engine else None

    async def ping(self) -> None:
        if self.engine:
            async with self.engine.connect() as connection:
                await connection.execute(text("SELECT 1"))

    async def close(self) -> None:
        if self.engine:
            await self.engine.dispose()
