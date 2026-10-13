"""Retry an isolated database operation; never replay module or AI invocations."""
import asyncio
from functools import wraps
from sqlalchemy.exc import DBAPIError, OperationalError, InterfaceError


async def finish_database_attempt(function, args, kwargs):
    """Drain an accepted database attempt before propagating caller cancellation."""
    operation = asyncio.create_task(function(*args, **kwargs))
    try:
        return await asyncio.shield(operation)
    except asyncio.CancelledError:
        # Interrupting a driver while its cursor/commit is in flight can leave
        # SQLite readers locked. Repeated caller cancellation must not interrupt
        # transaction cleanup either; this waits for one attempt without retrying.
        while not operation.done():
            try:
                await asyncio.shield(operation)
            except asyncio.CancelledError:
                continue
            except Exception:
                break
        if not operation.cancelled():
            operation.exception()
        raise


def database_retry(function):
    @wraps(function)
    async def retry(*args, **kwargs):
        delay = .2
        while True:
            try:
                return await finish_database_attempt(function, args, kwargs)
            except (DBAPIError, ConnectionError, TimeoutError) as error:
                if isinstance(error, DBAPIError) and not error.connection_invalidated and not isinstance(error, (OperationalError, InterfaceError)):
                    raise
                owner = args[0]
                app = getattr(owner, 'app', owner)
                if getattr(getattr(app.state, 'scheduler', None), 'stopping', False):
                    raise
                await asyncio.sleep(delay)
                delay = min(2, delay * 2)
    return retry
