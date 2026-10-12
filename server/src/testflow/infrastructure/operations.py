from collections.abc import Awaitable, Callable

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from testflow.core.errors import fail
from testflow.infrastructure.models import Idempotency, Operation
from testflow.infrastructure.revisions import digest, serialize


async def idempotent(db: AsyncSession, scope: str, key: str | None, payload: dict, create: Callable[[], Awaitable[dict]]) -> dict:
    if not key or len(key) > 128:
        fail("idempotency_key_required", "Idempotency-Key is required and must be at most 128 characters", 400)
    fingerprint = digest(payload)
    if db.bind.dialect.name == "postgresql":
        lock = int(digest([scope, key])[:15], 16)
        await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock})
    existing = await db.scalar(select(Idempotency).where(Idempotency.scope == scope, Idempotency.key == key))
    if existing:
        if existing.fingerprint != fingerprint:
            fail("idempotency_conflict", "This key was already used with different input", 409)
        return existing.response
    response = await create()
    db.add(Idempotency(scope=scope, key=key, fingerprint=fingerprint, response=response))
    await db.flush()
    return response


async def enqueue(db, kind: str, payload: dict) -> dict:
    row = Operation(kind=kind, payload=payload)
    db.add(row)
    await db.flush()
    return serialize(row)
