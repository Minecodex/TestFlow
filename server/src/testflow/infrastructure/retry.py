"""Retry an isolated database operation; never replay module or AI invocations."""
import asyncio
from functools import wraps
from sqlalchemy.exc import DBAPIError, OperationalError, InterfaceError


def database_retry(function):
    @wraps(function)
    async def retry(*args, **kwargs):
        delay = .2
        while True:
            try:
                return await function(*args, **kwargs)
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
