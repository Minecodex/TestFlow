import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi import HTTPException
from sqlalchemy.exc import SQLAlchemyError
from uuid import uuid4
from testflow.execution.runners.pods import PodManager
from testflow.execution.scheduler import Scheduler
from testflow.features.auth import router as auth_router
from testflow.features.resources import router as resources_router
from testflow.features.pipelines.router import router as pipelines_router
from testflow.features.assets.router import router as media_router
from testflow.features.assets.transfer_router import router as assets_transfer_router
from testflow.features.datasets.router import router as datasets_router
from testflow.features.modules.router import router as modules_router
from testflow.features.modules.resources import router as module_resources_router
from testflow.features.tasks.router import router as tasks_router
from testflow.features.executions.router import router as executions_router, socket_router
from testflow.features.system.workspace import router as workspace_router
from testflow.infrastructure.events import router as live_router

from testflow import __version__
from testflow.core.responses import ErrorResponse
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
        app.state.settings = config
        app.state.secret_values = {}
        app.state.pods = PodManager(app)
        app.state.scheduler = Scheduler(app)
        if config.environment == "production" and (not config.database_url or not config.admin_password_hash or not config.encryption_key):
            raise RuntimeError("Production requires database, admin password hash and encryption key")
        try:
            if app.state.database.sessions and config.scheduler_enabled:
                await app.state.scheduler.start()
            yield
        finally:
            if app.state.database.sessions:
                await app.state.scheduler.close()
            await app.state.pods.close()
            await app.state.database.close()

    app = FastAPI(title="TestFlow API", version=__version__, lifespan=lifespan, responses={code:{"model":ErrorResponse} for code in [401,403,409,422,503]})
    app.include_router(system_router, prefix="/api/v1")
    for router in [auth_router, workspace_router, modules_router, module_resources_router, media_router, assets_transfer_router, datasets_router, pipelines_router, tasks_router, executions_router, socket_router, live_router, resources_router]:
        app.include_router(router, prefix="/api/v1")

    @app.middleware("http")
    async def request_identity(request: Request, call_next):
        request.state.request_id = str(uuid4())
        origin = request.headers.get("origin")
        if request.method not in {"GET", "HEAD", "OPTIONS"} and origin and origin != config.public_url:
            return JSONResponse(status_code=403, content={"code": "origin_rejected", "message": "Request origin is not allowed", "fields": {}, "request_id": request.state.request_id})
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        return response

    @app.exception_handler(HTTPException)
    async def http_error(request, error):
        detail = error.detail if isinstance(error.detail, dict) else {"code": "request_error", "message": error.detail, "fields": {}}
        return JSONResponse(status_code=error.status_code, content={**detail, "request_id": request.state.request_id})

    @app.exception_handler(SQLAlchemyError)
    @app.exception_handler(ConnectionError)
    @app.exception_handler(TimeoutError)
    async def database_error(request, error):
        return JSONResponse(status_code=503, content={"code":"database_unavailable", "message":"Database temporarily unavailable; retry this request", "fields":{}, "request_id":request.state.request_id})

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        return JSONResponse(status_code=422, content={"code": "validation_error", "message": "Invalid request fields", "fields": {".".join(str(x) for x in e["loc"]): e["msg"] for e in error.errors()}, "request_id": request.state.request_id})

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
