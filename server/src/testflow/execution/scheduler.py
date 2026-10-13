import asyncio
import logging

from fastapi import HTTPException
from sqlalchemy import select, or_

from testflow.execution.engine import DAGRun
from testflow.features.evaluation.service import evaluate
from testflow.features.repositories.service import sync_repository
from testflow.features.tasks.reports import freeze_report
from testflow.infrastructure.events import emit
from testflow.infrastructure.models import Evaluation, Event, Execution, Operation, PlanItem, Runtime, Task, now
from testflow.infrastructure.operations import enqueue

logger = logging.getLogger(__name__)


class Scheduler:
    def __init__(self, app):
        self.app = app
        self.worker = None
        self.jobs: dict[str, asyncio.Task] = {}
        self.runs: dict[str, DAGRun] = {}
        self.stopping = False

    async def recover(self):
        async with self.app.state.database.sessions() as db, db.begin():
            executions = (await db.scalars(select(Execution).where(Execution.state == "running"))).all()
            for row in executions:
                row.state, row.error, row.ended, row.cleanup = "failed", {"code": "interrupted", "message": "Backend restarted; invocation cannot be recovered"}, now(), "interrupted"
                db.add(Event(execution_id=row.id, task_id=row.task_id, kind="execution.interrupted", data=row.error))
                if row.item_id: (await db.get(PlanItem, row.item_id)).state = "completed"
            items = (await db.scalars(select(PlanItem).where(PlanItem.state == "running"))).all()
            for item in items:
                ex = await db.scalar(select(Execution).where(Execution.item_id == item.id).order_by(Execution.attempt.desc()).limit(1))
                if ex and ex.state == "queued":
                    # This persisted invocation has never started; resume it as pending work.
                    item.state = "queued"
                elif ex and ex.state not in {"queued", "running"}: item.state = "completed"
                elif not ex: item.state = "queued"
            cleanup = (await db.scalars(select(Execution).where(Execution.cleanup == "stopping"))).all()
            for row in cleanup:
                row.cleanup = "interrupted"
                db.add(Event(execution_id=row.id, task_id=row.task_id, kind="cleanup.interrupted", data={"terminal_preserved": True}))
            evaluations = (await db.scalars(select(Evaluation).where(Evaluation.state == "running"))).all()
            for row in evaluations:
                row.state, row.error, row.ended = "error", {"code": "interrupted", "message": "Evaluation interrupted by restart"}, now()
                row.result = {"verdict": "error", "dimensions": []}
            operations = (await db.scalars(select(Operation).where(Operation.state == "running"))).all()
            for row in operations:
                row.state, row.error, row.updated = "interrupted", {"code": "interrupted", "message": "Operation interrupted by restart; not retried automatically"}, now()
            queued = (await db.scalars(select(Execution).where(Execution.state == "queued", or_(Execution.task_id.is_(None), Execution.batch_id != Execution.task_id)))).all()
            pending_ops = (await db.scalars(select(Operation).where(Operation.state == "queued", Operation.kind == "execution.run"))).all()
            for ex in queued:
                if not any(op.payload.get("execution_id") == ex.id for op in pending_ops):
                    await enqueue(db, "execution.run", {"execution_id": ex.id, "resumed_pending_only": True})
            tasks = (await db.scalars(select(Task).where(Task.state.in_(["queued", "running", "canceling"])))).all()
            for task in tasks:
                if task.state == "canceling":
                    task.state = "canceled"
                else:
                    task.state = "queued"
                    pending = (await db.scalars(select(Operation).where(Operation.kind == "task.run", Operation.state == "queued"))).all()
                    if not any(op.payload.get("task_id") == task.id for op in pending):
                        await enqueue(db, "task.run", {"task_id": task.id, "resumed_pending_only": True})
        async with self.app.state.database.sessions() as db:
            runtimes = (await db.scalars(select(Runtime).where(Runtime.state.in_(["preparing", "ready", "deleting", "lost"])))).all()
        for runtime in runtimes: await self.app.state.pods.terminate(runtime)

    async def start(self):
        await self.recover()
        self.worker = asyncio.create_task(self.loop(), name="durable-scheduler")

    async def close(self):
        self.stopping = True
        if self.worker: self.worker.cancel(); await asyncio.gather(self.worker, return_exceptions=True)
        for run in list(self.runs.values()):
            await run.terminal("failed", error={"code": "interrupted", "message": "Backend stopped during execution"})
        if self.jobs:
            try:
                async with asyncio.timeout(12): await asyncio.gather(*self.jobs.values(), return_exceptions=True)
            except TimeoutError:
                for task in self.jobs.values(): task.cancel()
                await asyncio.gather(*self.jobs.values(), return_exceptions=True)

    async def loop(self):
        while not self.stopping:
            try:
                self.jobs = {k: v for k, v in self.jobs.items() if not v.done()}
                if len(self.jobs) < 4:
                    async with self.app.state.database.sessions() as db, db.begin():
                        row = await db.scalar(select(Operation).where(Operation.state == "queued").order_by(Operation.created, Operation.id).with_for_update(skip_locked=True).limit(1))
                        if row:
                            row.state, row.updated = "running", now()
                            operation_id, kind, payload = row.id, row.kind, row.payload
                        else: operation_id = None
                    if operation_id: self.jobs[operation_id] = asyncio.create_task(self.handle(operation_id, kind, payload))
                await asyncio.sleep(.2)
            except asyncio.CancelledError: raise
            except Exception:
                logger.warning("Scheduler dependency unavailable; queued records remain durable")
                await asyncio.sleep(1)

    async def handle(self, operation_id, kind, payload):
        result, error = {}, None
        try:
            if kind == "repository.sync": result = await sync_repository(self.app, payload)
            elif kind == "module.import":
                from testflow.features.modules.router import finish_import
                result = await finish_import(self.app, payload)
            elif kind == "module.validate": result = await self.app.state.pods.validate(payload)
            elif kind == "task.run": result = await self.run_task(payload["task_id"])
            elif kind == "execution.run":
                await self.run_execution(payload["execution_id"])
                result = {"execution_id": payload["execution_id"]}
            elif kind == "evaluation.run":
                await evaluate(self.app, payload["evaluation_id"])
                async with self.app.state.database.sessions() as db, db.begin():
                    evaluation = await db.get(Evaluation, payload["evaluation_id"])
                    execution = await db.get(Execution, evaluation.execution_id)
                    if execution.task_id: await freeze_report(db, execution.task_id)
                result = {"evaluation_id": payload["evaluation_id"]}
            else: raise RuntimeError("Unsupported operation")
        except asyncio.CancelledError:
            error = {"code": "interrupted", "message": "Operation interrupted"}
        except Exception as e:
            if isinstance(e, HTTPException): error = e.detail
            else: error = {"code": "operation_error", "message": "Operation failed: " + (str(e)[:500] if isinstance(e, (RuntimeError, TimeoutError)) else type(e).__name__)}
        async with self.app.state.database.sessions() as db, db.begin():
            row = await db.get(Operation, operation_id)
            row.state, row.progress, row.result, row.error, row.updated = "failed" if error else "succeeded", 100, result, error, now()
            db.add(Event(kind="operation.changed", data={"operation_id": operation_id, "state": row.state}))

    async def run_execution(self, execution_id):
        async with self.app.state.database.sessions() as db:
            row = await db.get(Execution, execution_id)
        if row.state != "queued": return
        run = DAGRun(self.app, row); self.runs[row.id] = run
        try:
            await run.run()
            async with self.app.state.database.sessions() as db, db.begin():
                ex = await db.get(Execution, execution_id)
                evaluation = Evaluation(execution_id=ex.id, profile=ex.snapshot["profile"])
                db.add(evaluation); await db.flush(); evaluation_id = evaluation.id
                if ex.item_id: (await db.get(PlanItem, ex.item_id)).state = "completed"
            await evaluate(self.app, evaluation_id)
        except Exception:
            await run.terminal("failed", error={"code": "executor_error", "message": "Executor failed"})
            await run.cleanup()
            async with self.app.state.database.sessions() as db, db.begin():
                ex = await db.get(Execution, execution_id)
                if ex.item_id: (await db.get(PlanItem, ex.item_id)).state = "completed"
            raise
        finally:
            self.runs.pop(execution_id, None)
            self.app.state.secret_values.pop(execution_id, None)
            if row.batch_id != row.task_id: await self.app.state.pods.release_batch(row.batch_id)
        if row.task_id and row.batch_id != row.task_id:
            async with self.app.state.database.sessions() as db, db.begin(): await freeze_report(db, row.task_id)

    async def run_task(self, task_id):
        async with self.app.state.database.sessions() as db, db.begin():
            task = await db.scalar(select(Task).where(Task.id == task_id).with_for_update())
            if task.state not in {"queued", "running"}: return {"task_id": task_id, "state": task.state}
            task.state = "running"
            item_ids = (await db.scalars(select(PlanItem.id).where(PlanItem.task_id == task_id, PlanItem.state == "queued").order_by(PlanItem.position))).all()
            concurrency = task.effective_concurrency
        semaphore = asyncio.Semaphore(concurrency)
        async def item_run(identifier):
            async with semaphore:
                async with self.app.state.database.sessions() as db, db.begin():
                    task = await db.scalar(select(Task).where(Task.id == task_id).with_for_update())
                    item = await db.scalar(select(PlanItem).where(PlanItem.id == identifier).with_for_update())
                    if task.state in {"canceling", "canceled"} or item.state != "queued":
                        if item.state == "queued": item.state = "canceled"
                        return
                    item.state = "running"
                    ex = await db.scalar(select(Execution).where(Execution.item_id == item.id, Execution.state == "queued").with_for_update())
                    if not ex:
                        ex = Execution(item_id=item.id, task_id=task_id, batch_id=task_id, name=item.snapshot["case"]["name"], snapshot=item.snapshot)
                        db.add(ex)
                    await db.flush(); execution_id = ex.id
                await self.run_execution(execution_id)
        await asyncio.gather(*(item_run(identifier) for identifier in item_ids), return_exceptions=True)
        evidence = await self.app.state.pods.release_batch(task_id)
        async with self.app.state.database.sessions() as db, db.begin():
            task = await db.get(Task, task_id)
            executions = (await db.scalars(select(Execution).where(Execution.task_id == task_id))).all()
            task.state = "canceled" if task.state in {"canceling", "canceled"} else "completed_with_errors" if any(e.state != "succeeded" for e in executions) else "completed"
            await freeze_report(db, task_id)
        await emit(self.app, None, "task.completed", {"task_id": task_id, "state": task.state, "pod_cleanup": evidence}, task_id=task_id)
        return {"task_id": task_id, "state": task.state}
