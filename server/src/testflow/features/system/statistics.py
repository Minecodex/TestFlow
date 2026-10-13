"""Latest ended attempt per plan/root; a reevaluation error remains the current score."""
from sqlalchemy import select
from sqlalchemy.orm import load_only
from testflow.infrastructure.models import Evaluation, Execution, PlanItem
from testflow.features.evaluation.statistics import complete_dimensions, dimension_rates

async def workspace_scores(db, configuration=None):
    items = (await db.execute(select(PlanItem.id, PlanItem.snapshot["profile"].label("profile")))).all()
    attempts = (await db.execute(select(Execution.id, Execution.item_id, Execution.root_id, Execution.state,
                                        Execution.snapshot["profile"].label("profile"))
                                .order_by(Execution.attempt.desc(), Execution.created.desc()))).all()
    scores = (await db.scalars(select(Evaluation).options(load_only(Evaluation.id, Evaluation.execution_id, Evaluation.state, Evaluation.profile, Evaluation.result))
                              .where(Evaluation.state.not_in(["queued", "running"]))
                              .order_by(Evaluation.created.desc(), Evaluation.id.desc()))).all()
    by_execution = {}
    for score in scores: by_execution.setdefault(score.execution_id, []).append(score)
    samples = {"item:" + item.id: {"profile": item.profile, "execution": None} for item in items}
    for attempt in attempts:
        key = "item:" + attempt.item_id if attempt.item_id else "root:" + attempt.root_id
        sample = samples.setdefault(key, {"profile": attempt.profile, "execution": None})
        if sample["execution"] is None and attempt.state not in {"queued", "running"}: sample["execution"] = attempt
    dimensions, selected = [], []
    for sample in samples.values():
        frozen, execution = sample["profile"], sample["execution"]
        target = configuration or frozen
        assigned = target["revision_id"] == frozen["revision_id"]
        score = next((score for score in by_execution.get(execution.id if execution else None, [])
                      if score.profile["revision_id"] == target["revision_id"] and
                      (not assigned or score.profile.get("binding_digest") == frozen.get("binding_digest"))), None)
        if not assigned and score is None: continue
        profile = score.profile if score else frozen
        dimensions.extend(complete_dimensions(profile, score.result if score else None))
        if score: selected.append(score)
    return {"reference": dimension_rates(dimensions, True), "quality": dimension_rates(dimensions, False),
            "evaluations": {"total": sum(e.result.get("verdict") in {"pass", "fail"} for e in selected),
                            "attempted": len(selected), "pass": sum(e.result.get("verdict") == "pass" for e in selected),
                            "fail": sum(e.result.get("verdict") == "fail" for e in selected), "error": sum(e.state == "error" for e in selected)}}
