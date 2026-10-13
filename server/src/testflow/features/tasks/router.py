from fastapi import APIRouter, Depends, Header, Query, Request
from sqlalchemy import func, select

from testflow.core.contracts import TaskBody
from testflow.core.dependencies import session
from testflow.core.responses import PlanPreviewResponse, ReportsResponse, TaskDetailResponse, TaskPageResponse, TaskResponse
from testflow.core.errors import fail
from testflow.features.auth import require_admin
from testflow.features.tasks.reports import current_report, freeze_report
from testflow.features.tasks.service import create_task, plan_task
from testflow.infrastructure.models import Event, Execution, PlanItem, Report, Task
from testflow.infrastructure.operations import enqueue, idempotent
from testflow.infrastructure.revisions import resource_changed, serialize

router = APIRouter(prefix="/tasks", tags=["tasks"], dependencies=[Depends(require_admin)])


@router.post("/preview", response_model=PlanPreviewResponse)
async def preview(body: TaskBody, db=Depends(session, scope="function")):
    plan = await plan_task(db, body)
    return {**plan, "items": [{"name": i["case"]["name"], "pair_id": i["pair_id"], "repetition": i["repetition"], "dataset": i["dataset"]["name"], "pipeline": i["pipeline"]["name"], "input_snapshot": i["inputs"], "reference_confirmed": i["reference_confirmed"]} for i in plan["items"]]}


@router.post("", response_model=TaskResponse)
async def submit(body: TaskBody, idempotency_key: str = Header(..., min_length=1, max_length=128), db=Depends(session, scope="function")):
    async def create():
        task = await create_task(db, body)
        operation = await enqueue(db, "task.run", {"task_id": task["id"]})
        return {**task, "operation_id": operation["id"]}
    return await idempotent(db, "task.create", idempotency_key, body.model_dump(mode="json"), create)


@router.get("", response_model=TaskPageResponse)
async def tasks(hidden: bool = False, search: str = "", page: int = Query(1, ge=1), page_size: int = Query(30, ge=1, le=100), db=Depends(session, scope="function")):
    where = [Task.hidden == hidden]
    if search: where.append(Task.name.ilike("%" + search + "%"))
    total = await db.scalar(select(func.count()).select_from(Task).where(*where))
    rows = (await db.scalars(select(Task).where(*where).order_by(Task.created.desc(), Task.id).offset((page - 1) * page_size).limit(page_size))).all()
    return {"items": [{**serialize(r), "report": await current_report(db, r.id)} for r in rows], "total": total, "page": page, "page_size": page_size}


@router.get("/{task_id}", response_model=TaskDetailResponse)
async def task(task_id: str, db=Depends(session, scope="function")):
    row = await db.get(Task, task_id)
    if not row: fail("not_found", "Task not found", 404)
    return {**serialize(row), "report": await current_report(db, task_id)}


@router.get("/{task_id}/reports", response_model=ReportsResponse)
async def reports(task_id: str, db=Depends(session, scope="function")):
    if not await db.get(Task, task_id): fail("not_found", "Task not found", 404)
    rows = (await db.scalars(select(Report).where(Report.task_id == task_id).order_by(Report.created.desc(), Report.id.desc()))).all()
    return {"current": await current_report(db, task_id), "items": [serialize(r) for r in rows]}


@router.post("/{task_id}/cancel")
async def cancel(task_id: str, request: Request, db=Depends(session, scope="function")):
    row = await db.scalar(select(Task).where(Task.id == task_id).with_for_update())
    if not row: fail("not_found", "Task not found", 404)
    if row.state in {"completed", "completed_with_errors", "canceled"}: return {"state": row.state}
    row.state = "canceling"
    pending = (await db.scalars(select(PlanItem).where(PlanItem.task_id == task_id, PlanItem.state == "queued"))).all()
    for item in pending: item.state = "canceled"
    db.add(Event(task_id=task_id, kind="task.cancel_accepted", data={"remaining_canceled": len(pending)}))
    active = (await db.scalars(select(Execution).where(Execution.task_id == task_id, Execution.state.in_(["queued", "running"])).with_for_update())).all()
    from testflow.infrastructure.models import now
    for execution in active:
        if execution.state == "queued":
            execution.state, execution.cleanup, execution.ended = "canceled", "stopped", now()
            if execution.item_id: (await db.get(PlanItem, execution.item_id)).state = "canceled"
    if not any(execution.state == "running" for execution in active):
        row.state = "canceled"
        await freeze_report(db, task_id)
    accepted_state = row.state
    # Commit the accepted cancellation before racing terminal events.
    await db.commit()
    runs = list(request.app.state.scheduler.runs.values())
    for run in runs:
        if run.record.task_id == task_id: await run.terminal("canceled", error={"code": "user_cancel", "message": "Task canceled"})
    return {"state": accepted_state}


@router.post("/{task_id}/hide")
async def hide(task_id: str, db=Depends(session, scope="function")):
    row = await db.get(Task, task_id)
    if not row: fail("not_found", "Task not found", 404)
    row.hidden = True
    await resource_changed(db, "tasks", row.id, None, True)
    return {"hidden": True}
