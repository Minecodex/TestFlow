"""Execution cancellation drains a database transaction without replaying it."""
import asyncio

import pytest
from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from testflow.infrastructure.models import Event
from testflow.infrastructure.retry import database_retry


@pytest.mark.parametrize('fail', [False, True])
async def test_cancel_waits_for_transaction_and_does_not_retry(app_client, fail):
    app, _ = app_client
    started, release = asyncio.Event(), asyncio.Event()
    attempts = 0

    @database_retry
    async def persist(app):
        nonlocal attempts
        attempts += 1
        async with app.state.database.sessions() as db, db.begin():
            db.add(Event(kind='test.cancel_boundary', data={}))
            await db.flush()
            started.set()
            await release.wait()
            if fail:
                raise OperationalError('connection', {}, ConnectionRefusedError(), connection_invalidated=True)

    task = asyncio.create_task(persist(app))
    try:
        async with asyncio.timeout(5):
            await started.wait()
            task.cancel()
            await asyncio.sleep(0)
            task.cancel()
            await asyncio.sleep(0)
            assert not task.done(), 'Cancellation must wait for the accepted transaction'
            release.set()
            with pytest.raises(asyncio.CancelledError):
                await task
    finally:
        release.set()
        await asyncio.gather(task, return_exceptions=True)
    assert attempts == 1
    async with app.state.database.sessions() as db:
        rows = (await db.scalars(select(Event).where(Event.kind == 'test.cancel_boundary'))).all()
    assert len(rows) == (0 if fail else 1)
