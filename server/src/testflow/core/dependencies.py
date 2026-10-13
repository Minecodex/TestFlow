from fastapi import Request

from testflow.core.errors import fail


async def session(request: Request):
    # All HTTP consumers use scope="function": commit before success leaves the
    # server, so immediate navigation and module resource reads see the write.
    factory = request.app.state.database.sessions
    if not factory:
        fail("database_unavailable", "Database is not configured", 503)
    async with factory() as db:
        async with db.begin():
            yield db
