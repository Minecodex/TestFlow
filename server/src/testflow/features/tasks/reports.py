from sqlalchemy import select

from testflow.infrastructure.models import Evaluation, Execution, PlanItem, Report, Task
from testflow.infrastructure.revisions import digest, serialize
from testflow.features.evaluation.statistics import complete_dimensions, dimension_rates


async def current_report(db, task_id):
    task = await db.get(Task, task_id)
    items = (await db.scalars(select(PlanItem).where(PlanItem.task_id == task_id).order_by(PlanItem.position))).all()
    rows = []
    for item in items:
        attempts = (await db.scalars(select(Execution).where(Execution.item_id == item.id).order_by(Execution.attempt.desc()))).all()
        active = next((e for e in attempts if e.state in {"queued", "running"}), None)
        chosen = next((e for e in attempts if e.state not in {"queued", "running"}), None)
        evaluation = None
        if chosen:
            evaluations = (await db.scalars(select(Evaluation).where(Evaluation.execution_id == chosen.id, Evaluation.state.not_in(["queued", "running"])).order_by(Evaluation.created.desc(), Evaluation.id.desc()))).all()
            profile = item.snapshot["profile"]
            evaluation = next((e for e in evaluations if e.profile["revision_id"] == profile["revision_id"] and e.profile.get("binding_digest") == profile.get("binding_digest")), None)
        rows.append({"item_id": item.id, "pair_id": item.pair_id, "case": item.snapshot["case"], "dataset": {"id": item.snapshot["dataset"]["id"], "name": item.snapshot["dataset"]["name"], "version": item.snapshot["dataset"]["selected_version"]},
                     "pipeline": {"id": item.snapshot["pipeline"]["id"], "name": item.snapshot["pipeline"]["name"], "version": item.snapshot["pipeline"]["selected_version"]},
                     "sample_identity": digest(item.snapshot["inputs"]), "repetition": item.snapshot["repetition"], "plan_state": item.state,
                     "execution_id": chosen.id if chosen else None, "execution_state": chosen.state if chosen else item.state,
                     "active_execution_id": active.id if active else None, "evaluation_id": evaluation.id if evaluation else None,
                     "verdict": evaluation.result.get("verdict", "error") if evaluation else "unscored", "evaluation": evaluation.result if evaluation else None,
                     "duration_ms": chosen.duration_ms if chosen else None, "cleanup": chosen.cleanup if chosen else "pending",
                     "materials": {"input_schema": item.snapshot["pipeline"]["graph"]["input_schema"], "inputs": item.snapshot["inputs"],
                                   "output_schema": item.snapshot["pipeline"]["graph"]["output_schema"], "output": chosen.output if chosen else {},
                                   "reference": item.snapshot["reference"], "reference_confirmed": item.snapshot["reference_confirmed"]}})
    dimensions = [dimension for row, item in zip(rows, items)
                  for dimension in complete_dimensions(item.snapshot["profile"], row["evaluation"])]
    return {"task_id": task_id, "task_name": task.name, "state": task.state, "plan_count": len(items), "rows": rows,
            "requested_concurrency": task.requested_concurrency, "effective_concurrency": task.effective_concurrency,
            "restrictions": task.snapshot["restrictions"], "reference": dimension_rates(dimensions, True), "quality": dimension_rates(dimensions, False),
            "run_completed": sum(r["execution_state"] in {"succeeded", "failed", "canceled"} for r in rows),
            "evaluated": sum(r["evaluation_id"] is not None for r in rows), "passed": sum(r["verdict"] == "pass" for r in rows)}


async def freeze_report(db, task_id):
    report = Report(task_id=task_id, snapshot=await current_report(db, task_id))
    db.add(report); await db.flush()
    return serialize(report)
