from copy import deepcopy

from testflow.core.contracts import Dimension, PipelineBody
from testflow.core.errors import fail
from testflow.features.pipelines.service import resolve_graph, validate_graph
from testflow.infrastructure.models import PlanItem, Task, uid
from testflow.infrastructure.revisions import digest, get_resource, serialize


def logical(schema):
    return [{k: v for k, v in f.items() if k != "stream"} for f in schema["fields"]]


async def freeze_inputs(db, schema, bindings, *, current_assets=False, asset_cache=None):
    if set(bindings) != {f["name"] for f in schema["fields"]}: fail("input_fields", "Inputs must bind the full ordered group")
    result = {}
    for field in schema["fields"]:
        binding = bindings[field["name"]]
        if hasattr(binding, "model_dump"): binding = binding.model_dump(mode="json")
        if binding.get("asset_id"):
            identifier = binding["asset_id"]
            version = None if current_assets else binding.get("asset_version")
            asset = asset_cache.get(identifier) if current_assets and asset_cache is not None else None
            if asset is None:
                asset = await get_resource(db, "assets", identifier, version)
                if current_assets and asset_cache is not None:
                    asset_cache[identifier] = asset
            if asset["hidden"] or asset["data"]["type"] != field["type"] or asset["data"]["format"] != field["format"]:
                fail("invalid_input", "Input asset must be visible and match type and format", fields={field["name"]: "asset"})
            if field["type"] == "Text": result[field["name"]] = {"value": asset["data"]["text"], "asset": asset}
            else: result[field["name"]] = {"asset": asset}
        else:
            value = binding.get("value")
            if field["type"] not in {"Text", "JSON"} or (field["type"] == "Text" and not isinstance(value, str)):
                fail("invalid_input", "Literal values must match Text/JSON fields", fields={field["name"]: "value"})
            result[field["name"]] = {"value": value}
    return result


async def freeze_pipeline(db, identifier, version):
    pipeline = await get_resource(db, "pipelines", identifier, version)
    if pipeline["hidden"]: fail("hidden_resource", "Restore pipeline before execution")
    graph = await resolve_graph(db, PipelineBody.model_validate(pipeline["data"]), require_available=True)
    errors = validate_graph(graph)
    if errors: fail("invalid_graph", "Pipeline is not executable", fields={"graph": errors})
    return {**pipeline, "graph": graph}


def validate_bindings(profile, pipeline, bindings):
    result = deepcopy(profile)
    graph = pipeline["graph"]
    nodes = {n["id"]: n for n in graph["nodes"]}
    dimensions = []
    for original in profile["data"]["dimensions"]:
        dimension = Dimension.model_validate({**original, **bindings.get(original["id"], {})}).model_dump(mode="json")
        for key in ["actual", "reference", "evidence"]:
            candidates = dimension[key] if key == "evidence" else [dimension[key]]
            for binding in candidates:
                if not binding: continue
                source, field = binding["source"], binding["field"]
                if source == "node":
                    node = nodes.get(binding["node_id"])
                    if not node or field and field not in {f["name"] for f in node["output_schema"]["fields"]}: fail("invalid_binding", "Select an existing node output field")
                if source in {"output", "input", "reference"}:
                    schema = graph["input_schema"] if source == "input" else graph["output_schema"]
                    if field and field not in {f["name"] for f in schema["fields"]}: fail("invalid_binding", "Selected field is not in the named group")
                if source == "execution" and field not in {"state", "duration_ms", "cleanup"}: fail("invalid_binding", "Execution evidence must bind state, duration_ms or cleanup")
        method, actual = dimension["method"], dimension["actual"]
        if method == "completion" and actual != {"source":"execution", "field":"state", "node_id":None}:
            fail("invalid_binding", "Completion must bind execution.state")
        if method == "duration" and actual != {"source":"execution", "field":"duration_ms", "node_id":None}:
            fail("invalid_binding", "Duration must bind execution.duration_ms")
        if method in {"structure", "exact_text", "exact_json", "cer"} and actual["source"] not in {"output", "node"}:
            fail("invalid_binding", "Output rules require an explicit final or node output binding")
        if method in {"exact_text", "cer", "exact_json"}:
            schema = nodes[actual["node_id"]]["output_schema"] if actual["source"] == "node" else graph["output_schema"]
            field_spec = next((f for f in schema["fields"] if f["name"] == actual["field"]), None)
            if method in {"exact_text", "cer"} and (not field_spec or field_spec["type"] != "Text"):
                fail("invalid_binding", "Text comparison rules require an explicitly selected Text field")
            if method == "exact_json" and actual["field"] and (not field_spec or field_spec["type"] != "JSON"):
                fail("invalid_binding", "JSON comparison requires a JSON field or complete output group")
        dimensions.append(dimension)
    if set(bindings) - {d["id"] for d in dimensions}: fail("invalid_binding", "Unknown evaluation dimension")
    result["data"]["dimensions"] = dimensions
    result["binding_digest"] = digest(dimensions)
    return result


async def plan_task(db, body):
    profile = await get_resource(db, "evaluation-profiles", body.profile_id, body.profile_version)
    if profile["hidden"]: fail("hidden_resource", "Restore evaluation profile first")
    items, restrictions, pairs = [], [], []
    duplicate_pairs = set()
    asset_cache = {}
    for pair in body.pairs:
        key = (pair.dataset_id, pair.dataset_version, pair.pipeline_id, pair.pipeline_version)
        if key in duplicate_pairs: fail("duplicate_pair", "Duplicate test pair")
        duplicate_pairs.add(key)
        dataset = await get_resource(db, "datasets", pair.dataset_id, pair.dataset_version)
        if dataset["hidden"]: fail("hidden_resource", "Restore dataset before creating a task")
        if "output_schema" in dataset["data"]:
            fail("outdated_dataset_contract", "Select the current input-only dataset revision", fields={"dataset_version": dataset["version"]})
        pipeline = await freeze_pipeline(db, pair.pipeline_id, pair.pipeline_version)
        if logical(dataset["data"]["input_schema"]) != logical(pipeline["graph"]["input_schema"]):
            fail("pair_schema_mismatch", "Dataset inputs must match the pipeline start group exactly")
        if not dataset["data"]["cases"]: fail("empty_dataset", "Dataset must contain cases")
        for n in pipeline["graph"]["nodes"]:
            if n["kind"] == "module" and n["runtime"]["requires_sequential"]:
                restrictions.append({"node_id": n["id"], "name": n["name"], "module_revision": n["module_snapshot"]["revision_id"]})
        bound_profile = validate_bindings(profile, pipeline, pair.bindings)
        pair_id = uid(); pairs.append({"id": pair_id, **pair.model_dump(mode="json")})
        seen = set()
        for case in dataset["data"]["cases"]:
            inputs = await freeze_inputs(db, dataset["data"]["input_schema"], case["inputs"], current_assets=True, asset_cache=asset_cache)
            identity = digest(inputs)
            if identity in seen: continue
            seen.add(identity)
            frozen_case = {k: deepcopy(v) for k, v in case.items() if k in {"id", "name", "inputs"}}
            frozen_case["inputs"] = {name: {"asset_id": value["asset"]["id"], "asset_version": value["asset"]["selected_version"]}
                                     if value.get("asset") else {"value": value["value"]} for name, value in inputs.items()}
            for repetition in range(pair.repetitions):
                snapshot = {"case": frozen_case, "dataset": dataset, "pipeline": pipeline, "profile": bound_profile, "inputs": inputs,
                            "reference": {}, "reference_confirmed": False, "reference_sources": {}, "repetition": repetition + 1, "pair_id": pair_id}
                items.append(snapshot)
    for snapshot in items:
        snapshot["concurrency"] = {"requested": body.concurrency, "effective": 1 if restrictions else body.concurrency, "restrictions": restrictions}
    return {"profile": profile, "pairs": pairs, "items": items, "requested_concurrency": body.concurrency,
            "effective_concurrency": 1 if restrictions else body.concurrency, "restrictions": restrictions, "plan_count": len(items)}


async def create_task(db, body):
    plan = await plan_task(db, body)
    row = Task(name=body.name, snapshot={k: v for k, v in plan.items() if k != "items"}, requested_concurrency=body.concurrency, effective_concurrency=plan["effective_concurrency"])
    db.add(row); await db.flush()
    for index, snapshot in enumerate(plan["items"]):
        db.add(PlanItem(task_id=row.id, pair_id=snapshot["pair_id"], position=index, snapshot=snapshot))
    await db.flush()
    return serialize(row)
