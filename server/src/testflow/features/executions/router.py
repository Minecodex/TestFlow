import asyncio

from fastapi import APIRouter, Depends, Header, Query, Request, WebSocket
from sqlalchemy import func, select
from sqlalchemy.orm import aliased

from testflow.core.contracts import QuickExecutionBody
from testflow.core.dependencies import session
from testflow.core.responses import EvaluationResponse, EventPageResponse, ExecutionPageResponse, ExecutionResponse
from testflow.core.errors import fail
from testflow.features.auth import require_admin
from testflow.features.tasks.service import freeze_inputs, freeze_pipeline, validate_bindings
from testflow.infrastructure.events import authorize_socket, emit
from testflow.infrastructure.models import Evaluation, Event, Execution, PlanItem, uid
from testflow.infrastructure.operations import enqueue, idempotent
from testflow.infrastructure.revisions import get_resource, serialize

router = APIRouter(prefix="/executions", tags=["executions"], dependencies=[Depends(require_admin)])
socket_router = APIRouter(tags=["executions"])


@router.post("/quick", response_model=ExecutionResponse)
async def quick(body: QuickExecutionBody, idempotency_key: str = Header(..., min_length=1, max_length=128), db=Depends(session)):
    async def create():
        pipeline = await freeze_pipeline(db, body.pipeline_id, body.pipeline_version)
        profile = await get_resource(db, "evaluation-profiles", body.profile_id, body.profile_version)
        profile = validate_bindings(profile, pipeline, body.bindings)
        if body.live and any(not f["stream"] for f in pipeline["graph"]["input_schema"]["fields"]): fail("live_schema", "Live input requires streaming start fields")
        inputs = {} if body.live else await freeze_inputs(db, pipeline["graph"]["input_schema"], body.inputs)
        snapshot = {"pipeline": pipeline, "profile": profile, "inputs": inputs, "reference": body.reference, "reference_confirmed": body.reference_confirmed, "live": body.live, "case": {"id": uid(), "name": "Quick execution"}}
        row = Execution(batch_id=uid(), name="Quick execution", snapshot=snapshot)
        db.add(row); await db.flush()
        op = await enqueue(db, "execution.run", {"execution_id": row.id})
        return {**serialize(row), "operation_id": op["id"]}
    return await idempotent(db, "execution.quick", idempotency_key, body.model_dump(mode="json"), create)


@router.get("", response_model=ExecutionPageResponse)
async def executions(state: str = "", task_id: str = "", dataset_id: str = "", pipeline_id: str = "", search: str = "", all_attempts: bool = True, page: int = Query(1, ge=1), page_size: int = Query(30, ge=1, le=100), db=Depends(session)):
    where = []
    if state: where.append(Execution.state == state)
    if task_id: where.append(Execution.task_id == task_id)
    if search:
        pattern = "%" + search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        fields = [Execution.name, Execution.id, Execution.trace_id, Execution.error["code"].as_string(),
                  Execution.error["message"].as_string(), Execution.snapshot["pipeline"]["name"].as_string(),
                  Execution.snapshot["dataset"]["name"].as_string()]
        from sqlalchemy import or_
        where.append(or_(*(field.ilike(pattern, escape="\\") for field in fields)))
    if dataset_id: where.append(Execution.snapshot["dataset"]["id"].as_string() == dataset_id)
    if pipeline_id: where.append(Execution.snapshot["pipeline"]["id"].as_string() == pipeline_id)
    if not all_attempts:
        other = aliased(Execution)
        latest = select(func.max(other.attempt)).where(other.root_id == Execution.root_id).correlate(Execution).scalar_subquery()
        where.append(Execution.attempt == latest)
    total = await db.scalar(select(func.count()).select_from(Execution).where(*where))
    rows = (await db.scalars(select(Execution).where(*where).order_by(Execution.created.desc(), Execution.id).offset((page - 1) * page_size).limit(page_size))).all()
    result = []
    for row in rows:
        evaluations = (await db.scalars(select(Evaluation).where(Evaluation.execution_id == row.id).order_by(Evaluation.created.desc(), Evaluation.id.desc()))).all()
        result.append({**serialize(row), "evaluations": [serialize(e) for e in evaluations]})
    return {"items": result, "total": total, "page": page, "page_size": page_size}


@router.get("/{execution_id}", response_model=ExecutionResponse)
async def execution(execution_id: str, db=Depends(session)):
    row = await db.get(Execution, execution_id)
    if not row: fail("not_found", "Execution not found", 404)
    evaluations = (await db.scalars(select(Evaluation).where(Evaluation.execution_id == row.id).order_by(Evaluation.created.desc(), Evaluation.id.desc()))).all()
    events = (await db.scalars(select(Event).where(Event.execution_id == row.id).order_by(Event.id))).all()
    attempts = (await db.scalars(select(Execution).where(Execution.root_id == row.root_id).order_by(Execution.attempt.desc()))).all()
    return {**serialize(row), "evaluations": [serialize(e) for e in evaluations], "events": [serialize(e) for e in events], "attempts": [serialize(e) for e in attempts]}


@router.get("/{execution_id}/events", response_model=EventPageResponse)
async def events(execution_id: str, cursor: int = 0, page_size: int = Query(200, ge=1, le=1000), db=Depends(session)):
    if not await db.get(Execution, execution_id): fail("not_found", "Execution not found", 404)
    rows = (await db.scalars(select(Event).where(Event.execution_id == execution_id, Event.id > cursor).order_by(Event.id).limit(page_size))).all()
    return {"items": [serialize(r) for r in rows], "cursor": rows[-1].id if rows else cursor}


@router.post("/{execution_id}/cancel")
async def cancel(execution_id: str, request: Request, db=Depends(session)):
    row = await db.get(Execution, execution_id)
    if not row: fail("not_found", "Execution not found", 404)
    run = request.app.state.scheduler.runs.get(execution_id)
    if run:
        await run.terminal("canceled", error={"code": "user_cancel", "message": "Execution canceled"})
    elif row.state == "queued":
        from testflow.infrastructure.models import now
        row.state, row.ended, row.cleanup = "canceled", now(), "stopped"
        db.add(Event(execution_id=row.id, task_id=row.task_id, kind="execution.canceled", data={"before_start": True}))
    return {"state": "cancel_accepted"}


@router.post("/{execution_id}/rerun", response_model=ExecutionResponse)
async def rerun(execution_id: str, idempotency_key: str = Header(..., min_length=1, max_length=128), db=Depends(session)):
    original = await db.scalar(select(Execution).where(Execution.id == execution_id).with_for_update())
    if not original: fail("not_found", "Execution not found", 404)
    async def create():
        if original.state in {"queued", "running"}: fail("execution_active", "Wait for execution to finish", 409)
        if original.item_id:
            await db.scalar(select(PlanItem).where(PlanItem.id == original.item_id).with_for_update())
            active = await db.scalar(select(Execution).where(Execution.item_id == original.item_id, Execution.state.in_(["queued", "running"])))
            if active: fail("execution_active", "An attempt is already active", 409)
            attempt = 1 + (await db.scalar(select(func.max(Execution.attempt)).where(Execution.item_id == original.item_id)))
        else:
            siblings = (await db.scalars(select(Execution).where(Execution.root_id == original.root_id).with_for_update())).all()
            if any(e.state in {"queued", "running"} for e in siblings): fail("execution_active", "An attempt is already active", 409)
            attempt = 1 + max(e.attempt for e in siblings)
        snapshot = original.snapshot
        if snapshot.get("live"):
            inputs = {}
            schema = snapshot["pipeline"]["graph"]["input_schema"]
            for field in schema["fields"]:
                value = original.actual_inputs.get(field["name"], {})
                if not value.get("eos"): fail("live_replay_incomplete", "Live input is incomplete; select captured assets in a new quick run", 409)
                if field["type"] == "Text": inputs[field["name"]] = {"value": value["text"]}
                else:
                    asset = await get_resource(db, "assets", value["asset_id"], value["asset_version"])
                    inputs[field["name"]] = {"asset": asset}
            snapshot = {**snapshot, "live": False, "inputs": inputs, "replayed_from": original.id}
        row = Execution(root_id=original.root_id, item_id=original.item_id, task_id=original.task_id, batch_id=uid(), attempt=attempt, name=original.name, snapshot=snapshot)
        db.add(row); await db.flush()
        op = await enqueue(db, "execution.run", {"execution_id": row.id})
        return {**serialize(row), "operation_id": op["id"]}
    return await idempotent(db, "execution.rerun:" + execution_id, idempotency_key, {}, create)


@router.post("/{execution_id}/reevaluate", response_model=EvaluationResponse)
async def reevaluate(execution_id: str, profile_id: str | None = None, profile_version: int | None = None, idempotency_key: str = Header(..., min_length=1, max_length=128), db=Depends(session)):
    ex = await db.get(Execution, execution_id)
    if not ex: fail("not_found", "Execution not found", 404)
    async def create():
        if ex.state in {"queued", "running"}: fail("execution_active", "Execution must finish before evaluation", 409)
        profile = ex.snapshot["profile"]
        if profile_id:
            profile = await get_resource(db, "evaluation-profiles", profile_id, profile_version)
            profile = validate_bindings(profile, ex.snapshot["pipeline"], {})
        row = Evaluation(execution_id=ex.id, profile=profile)
        db.add(row); await db.flush()
        op = await enqueue(db, "evaluation.run", {"evaluation_id": row.id})
        return {**serialize(row), "operation_id": op["id"]}
    return await idempotent(db, "execution.reevaluate:" + execution_id, idempotency_key, {"profile_id": profile_id, "profile_version": profile_version}, create)


@socket_router.websocket("/executions/{execution_id}/input")
async def live_input(socket: WebSocket, execution_id: str):
    if not await authorize_socket(socket): return
    await socket.accept()
    run = None
    try:
        async with asyncio.timeout(60):
            while not run:
                run = socket.app.state.scheduler.runs.get(execution_id)
                if not run: await asyncio.sleep(.1)
        if not run.record.snapshot.get("live") or run.done.is_set(): raise ValueError("Execution does not accept live input")
        start = next(n for n in run.nodes.values() if n["kind"] == "start")
        fields = run.groups[start["id"]]
        while not all(f.complete.is_set() for f in fields.values()):
            event = await socket.receive_json()
            field = fields.get(event.get("field"))
            if not field or event.get("type") not in {"input.chunk", "input.eos"}: raise ValueError("Invalid live field event")
            await field.put(event["type"].split(".")[1], event)
            await run.event(event["type"], event, start["id"])
        await socket.send_json({"type": "input.completed"})
    except Exception:
        if run and not run.done.is_set(): await run.terminal("failed", error={"code": "input_disconnected", "message": "Live input closed without complete EOS"})
    finally:
        if run:
            await run.capture_input()
