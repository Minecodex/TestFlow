from fastapi import Request

from testflow.core.errors import fail


async def session(request: Request):
    factory = request.app.state.database.sessions
    if not factory:
        fail("database_unavailable", "Database is not configured", 503)
    async with factory() as db:
        async with db.begin():
            yield db
