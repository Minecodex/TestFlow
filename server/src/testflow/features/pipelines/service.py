from collections import defaultdict, deque

from jsonschema import Draft202012Validator
from sqlalchemy import select

from testflow.core.contracts import PipelineBody, Schema
from testflow.core.errors import fail
from testflow.features.auth import validate_credential
from testflow.infrastructure.models import Operation
from testflow.infrastructure.revisions import get_resource


def validate_graph(graph: dict) -> list[dict]:
    errors = []
    nodes = {n["id"]: n for n in graph["nodes"]}
    def error(message, node=None):
        errors.append({"message": message, "node_id": node})
    if len(nodes) != len(graph["nodes"]):
        error("Duplicate node IDs")
    starts = [n for n in nodes.values() if n["kind"] == "start"]
    ends = [n for n in nodes.values() if n["kind"] == "end"]
    if len(starts) != 1 or not ends:
        error("Exactly one start and at least one end are required")
    incoming, outgoing = defaultdict(list), defaultdict(list)
    seen = set()
    for edge in graph["edges"]:
        a, b = edge["source"], edge["target"]
        if a not in nodes or b not in nodes or a == b or (a, b) in seen:
            error("Invalid or duplicate edge", b)
            continue
        seen.add((a, b))
        incoming[b].append(a)
        outgoing[a].append(b)
    for n in nodes.values():
        nid, kind = n["id"], n["kind"]
        if kind == "start":
            if incoming[nid]: error("Start cannot have predecessors", nid)
            if n.get("output_schema") != graph["input_schema"]: error("Start output must equal pipeline input", nid)
        elif kind == "assembly":
            mappings = n.get("mappings", [])
            targets = (n.get("output_schema") or {}).get("fields", [])
            if [m["target"] for m in mappings] != [f["name"] for f in targets]:
                error("Assembly mappings must cover ordered target fields exactly", nid)
            if {m["source"] for m in mappings} != set(incoming[nid]):
                error("Assembly requires exactly its selected source groups", nid)
            for target, mapping in zip(targets, mappings):
                source = nodes.get(mapping["source"], {})
                field = next((f for f in (source.get("output_schema") or {}).get("fields", []) if f["name"] == mapping["field"]), None)
                if field is None or {k: v for k, v in field.items() if k != "name"} != {k: v for k, v in target.items() if k != "name"}:
                    error("Assembly field type, format and stream must match", nid)
        else:
            if len(incoming[nid]) != 1:
                error("Ordinary nodes and ends require one complete predecessor", nid)
            elif nodes[incoming[nid][0]].get("output_schema") != n.get("input_schema"):
                error("Complete groups must match names, order, types, formats and streaming", nid)
            if kind == "end":
                if outgoing[nid]: error("End cannot have successors", nid)
                if n.get("input_schema") != graph["output_schema"]: error("All ends use the pipeline output schema", nid)
            if kind == "conversion":
                expected = [{**f, "stream": n.get("direction") == "to_stream" and f["type"] != "JSON"} for f in (n.get("input_schema") or {}).get("fields", [])]
                if n.get("direction") not in {"to_stream", "to_full"} or (n.get("output_schema") or {}).get("fields") != expected:
                    error("Conversion must explicitly preserve fields and change stream mode", nid)
    indegree = {k: len(incoming[k]) for k in nodes}
    queue = deque(k for k, degree in indegree.items() if degree == 0)
    visited = 0
    while queue:
        nid = queue.popleft(); visited += 1
        for target in outgoing[nid]:
            indegree[target] -= 1
            if indegree[target] == 0: queue.append(target)
    if visited != len(nodes): error("Graph must be acyclic")
    if len(starts) == 1:
        reachable, queue = set(), [starts[0]["id"]]
        while queue:
            nid = queue.pop()
            if nid in reachable: continue
            reachable.add(nid); queue.extend(outgoing[nid])
        if reachable != set(nodes): error("Every node must be reachable from start")
        backwards, queue = set(), [n["id"] for n in ends]
        while queue:
            nid = queue.pop()
            if nid in backwards: continue
            backwards.add(nid); queue.extend(incoming[nid])
        if backwards != set(nodes): error("Every node must lead to an end")
    return errors


async def resolve_graph(db, body: PipelineBody, *, require_available=False) -> dict:
    graph = body.model_dump(mode="json")
    for n in graph["nodes"]:
        if n["kind"] == "start":
            n["output_schema"] = graph["input_schema"]
        elif n["kind"] == "end":
            n["input_schema"] = graph["output_schema"]
            n["output_schema"] = graph["output_schema"]
        elif n["kind"] == "module":
            if not n["module_id"] or not n["module_version"]:
                fail("module_required", "Select a fixed module version", fields={n["id"]: "module"})
            module = await get_resource(db, "modules", n["module_id"], n["module_version"])
            if module["hidden"] and require_available:
                fail("hidden_module", "Hidden modules cannot be used for new execution")
            n["module_snapshot"] = module
            data = module["data"]
            n["input_schema"], n["output_schema"] = data["inputs"], data["outputs"]
            n["runtime"] = n["runtime"] or data["manifest"]["runtime"]
            declared = data["manifest"]["runtime"]
            if declared["requires_sequential"] and not n["runtime"]["requires_sequential"]:
                fail("sequential_required", "The module requires sequential execution", fields={n["id"]: "requires_sequential"})
            if declared["reuse_scope"] == "execution_node" and n["runtime"]["reuse_scope"] != "execution_node":
                fail("isolated_instance_required", "The module requires a separate Pod per execution", fields={n["id"]: "reuse_scope"})
            param_errors = list(Draft202012Validator(data["parameters"]).iter_errors(n["parameters"]))
            if param_errors:
                fail("invalid_parameters", "Module parameters do not match Schema", fields={n["id"]: param_errors[0].message})
            await validate_credential(db, n["runtime"].get("registry_credential_id"), "registry")
            from testflow.infrastructure.redaction import credential_refs
            for reference in credential_refs(data["parameters"], n["parameters"]):
                await validate_credential(db, reference, "module")
            mount = n["runtime"].get("code_mount")
            if mount:
                repo = await get_resource(db, "repositories", mount["repository_id"], mount["repository_version"])
                if repo["data"].get("commit") != mount["commit"] or not repo["data"].get("code_path") or (repo["hidden"] and require_available):
                    fail("code_unavailable", "A synced fixed repository commit is required")
                n["repository_snapshot"] = repo
            if require_available:
                validations = (await db.scalars(select(Operation).where(Operation.kind == "module.validate", Operation.state == "succeeded").order_by(Operation.created.desc()))).all()
                valid = next((v for v in validations if v.payload.get("revision_id") == module["revision_id"] and v.payload.get("runtime") == n["runtime"]), None)
                if not valid:
                    fail("module_not_validated", "Validate this module runtime before execution", fields={n["id"]: "validation_required"})
                n["validated_image_id"] = valid.result.get("image_id")
    return graph
