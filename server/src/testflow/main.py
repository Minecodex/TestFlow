import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from testflow import __version__
from testflow.core.config import Settings
from testflow.features.system.router import router as system_router
from testflow.infrastructure.database import Database
from testflow.infrastructure.storage import DataDirectories

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        storage = DataDirectories(config.data_dir)
        storage.prepare()
        app.state.storage = storage
        app.state.database = Database(config)
        try:
            yield
        finally:
            await app.state.database.close()

    app = FastAPI(title="TestFlow API", version=__version__, lifespan=lifespan)
    app.include_router(system_router, prefix="/api/v1")

    @app.get("/health/live", tags=["health"])
    async def live() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/health/ready", tags=["health"])
    async def ready(request: Request):
        try:
            await asyncio.to_thread(request.app.state.storage.check_writable)
            async with asyncio.timeout(2):
                await request.app.state.database.ping()
        except Exception:
            logger.warning("Readiness dependency unavailable")
            return JSONResponse(status_code=503, content={"status": "not_ready"})
        return {"status": "ready"}

    return app


app = create_app()
