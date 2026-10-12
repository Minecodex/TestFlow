from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select

from testflow.core.dependencies import session
from testflow.features.auth import require_admin
from testflow.infrastructure.models import Evaluation, Execution, PlanItem, Resource, Task
from testflow.infrastructure.revisions import get_resource, serialize
from testflow.features.tasks.reports import current_report
from testflow.features.system.statistics import workspace_scores
from testflow.core.responses import OverviewResponse

router = APIRouter(prefix="/system", tags=["workspace"], dependencies=[Depends(require_admin)])


@router.get("/overview", response_model=OverviewResponse)
async def overview(profile_id: str | None = None, profile_version: int | None = Query(None, ge=1), db=Depends(session)):
    counts = dict((await db.execute(select(Resource.kind, func.count()).where(Resource.hidden.is_(False)).group_by(Resource.kind))).all())
    counts["tasks"] = await db.scalar(select(func.count()).select_from(Task).where(Task.hidden.is_(False)))
    counts["planned_cases"] = await db.scalar(select(func.count()).select_from(PlanItem).join(Task, PlanItem.task_id == Task.id).where(Task.hidden.is_(False)))
    counts["executions"] = await db.scalar(select(func.count()).select_from(Execution))
    counts["evaluation"] = counts.get("evaluation-profiles", 0)
    tasks = (await db.scalars(select(Task).where(Task.hidden.is_(False)).order_by(Task.created.desc()).limit(5))).all()
    runs = dict((await db.execute(select(Execution.state, func.count()).group_by(Execution.state))).all())
    configuration = await get_resource(db, "evaluation-profiles", profile_id, profile_version) if profile_id else None
    scores = await workspace_scores(db, configuration)
    return {"counts": counts, "runs": runs, **scores,
            "tasks": [{**serialize(t), "report": await current_report(db, t.id)} for t in tasks]}


@router.get("/search")
async def search(q: str, db=Depends(session)):
    if not q.strip(): return {"items": []}
    query = select(Resource).where(Resource.hidden.is_(False), Resource.name.ilike("%" + q + "%")).order_by(Resource.updated.desc()).limit(30)
    resources = (await db.scalars(query)).all()
    tasks = (await db.scalars(select(Task).where(Task.hidden.is_(False), Task.name.ilike("%" + q + "%")).limit(10))).all()
    executions = (await db.scalars(select(Execution).where(Execution.name.ilike("%"+q+"%") | Execution.id.ilike("%"+q+"%")).order_by(Execution.created.desc()).limit(10))).all()
    return {"items": [{"id": r.id, "kind": r.kind, "name": r.name, "version": r.version} for r in resources] + [{"id": t.id, "kind": "tasks", "name": t.name} for t in tasks] + [{"id":e.id,"kind":"executions","name":e.name} for e in executions]}
