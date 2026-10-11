from fastapi import APIRouter, Request

from testflow import __version__
from testflow.features.system.schemas import FeatureStatus, SystemStatus

router = APIRouter(prefix="/system", tags=["system"])
FEATURES = ("repositories", "modules", "assets", "datasets", "pipelines", "evaluation", "tasks", "executions")


@router.get("/status", response_model=SystemStatus)
async def system_status(request: Request) -> SystemStatus:
    return SystemStatus(
        version=__version__,
        database="configured" if request.app.state.database.engine else "not_configured",
        features=[FeatureStatus(id=feature) for feature in FEATURES],
    )
