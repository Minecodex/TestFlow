from typing import Literal

from fastapi import APIRouter, Depends, Header, Query, Request
from pydantic import create_model
from sqlalchemy import select

from testflow.core.contracts import AssetBody, DatasetBody, EvaluationProfileBody, PipelineBody, RepositoryBody
from testflow.core.responses import ResourceResponse, ResourcePageResponse, RevisionPageResponse, OperationResponse
from testflow.core.dependencies import session
from testflow.core.errors import fail
from testflow.features.auth import require_admin, validate_credential
from testflow.features.pipelines.service import resolve_graph, validate_graph
from testflow.infrastructure.models import Operation, Resource, Revision
from testflow.infrastructure.operations import enqueue, idempotent
from testflow.infrastructure.revisions import get_resource, list_resources, save_resource, serialize

ResourceKind = Literal["repositories", "modules", "assets", "datasets", "pipelines", "evaluation-profiles"]
router = APIRouter(dependencies=[Depends(require_admin)], tags=["resources"])


async def validate_body(db, kind, body):
    data = body.model_dump(mode="json")
    if kind in {"repositories", "evaluation-profiles"}:
        await validate_credential(db, data.get("credential_id"), "git" if kind == "repositories" else "evaluation")
    if kind == "pipelines":
        # Save drafts as versions; execution preflight requires a valid connected graph.
        resolved = await resolve_graph(db, body)
        data = {k: v for k, v in resolved.items() if k != "nodes"}
        data["nodes"] = [n.model_dump(mode="json") for n in body.nodes]
    if kind == "datasets":
        for c in body.cases:
            for f in body.input_schema.fields:
                binding = c.inputs[f.name]
                if binding.asset_id:
                    asset = await get_resource(db, "assets", binding.asset_id, binding.asset_version)
                    if asset["hidden"] or asset["data"]["type"] != f.type or asset["data"]["format"] != f.format:
                        fail("invalid_asset_binding", "Asset type and format must match the named field", fields={c.id: f.name})
                elif f.type not in {"Text", "JSON"}:
                    fail("media_asset_required", "Media inputs require fixed assets")
                elif f.type == "Text" and not isinstance(binding.value, str):
                    fail("invalid_input_literal", "Text inputs require a string literal", fields={c.id: f.name})
    if kind == "assets" and body.type == "Text" and not body.blob:
        import hashlib
        content = body.text.encode("utf-8")
        data.update(size=len(content), sha256=hashlib.sha256(content).hexdigest(), format="UTF-8")
    if kind == "repositories":
        data.update(commit=None, commits=[], code_path=None, sync_state="not_synced", synced_at=None)
    return data


def install_writes(kind, model):
    update_model = create_model(kind.replace("-", "_") + "Update", expected_version=(int, ...), data=(model, ...))
    async def create(body, db=Depends(session)):
        if kind == "assets" and (body.type != "Text" or body.blob or body.original_blob or body.sha256 or body.metadata):
            fail("upload_required", "Create media using the validated upload endpoint")
        return await save_resource(db, kind, await validate_body(db, kind, body))
    async def update(resource_id: str, body, db=Depends(session)):
        data = await validate_body(db, kind, body.data)
        if kind == "assets":
            previous = await get_resource(db, kind, resource_id, body.expected_version)
            for key in ["blob", "original_blob", "sha256", "size", "metadata", "type", "format", "source"]:
                data[key] = previous["data"][key]
            data["text"] = previous["data"]["text"]
        return await save_resource(db, kind, data, resource_id, body.expected_version)
    create.__annotations__["body"] = model
    update.__annotations__["body"] = update_model
    create.__name__ = "create_" + kind.replace("-", "_")
    update.__name__ = "update_" + kind.replace("-", "_")
    router.add_api_route("/" + kind, create, methods=["POST"], response_model=ResourceResponse)
    router.add_api_route("/" + kind + "/{resource_id}", update, methods=["PUT"], response_model=ResourceResponse)


for kind, model in {"repositories": RepositoryBody, "assets": AssetBody, "datasets": DatasetBody,
                    "pipelines": PipelineBody, "evaluation-profiles": EvaluationProfileBody}.items():
    install_writes(kind, model)


@router.get("/operations/{operation_id}", response_model=OperationResponse)
async def operation(operation_id: str, db=Depends(session)):
    row = await db.get(Operation, operation_id)
    if not row: fail("not_found", "Operation not found", 404)
    return serialize(row)


@router.post("/pipelines/validate")
async def pipeline_validate(body: PipelineBody, db=Depends(session)):
    graph = await resolve_graph(db, body)
    return {"valid": not (errors := validate_graph(graph)), "errors": errors, "graph": graph}


@router.post("/repositories/{resource_id}/sync", response_model=OperationResponse)
async def repository_sync(resource_id: str, idempotency_key: str = Header(..., min_length=1, max_length=128), db=Depends(session)):
    async def create():
        repo = await get_resource(db, "repositories", resource_id)
        if repo["hidden"]: fail("hidden_resource", "Restore the repository first")
        return await enqueue(db, "repository.sync", {"resource": repo})
    return await idempotent(db, "repo.sync:" + resource_id, idempotency_key, {}, create)


@router.get("/{kind}", response_model=ResourcePageResponse)
async def resources(kind: ResourceKind, hidden: bool = False, search: str = "", type: Literal["Text", "Audio", "Image"] | None = None, page: int = Query(1, ge=1), page_size: int = Query(30, ge=1, le=100), db=Depends(session)):
    result = await list_resources(db, kind, hidden, search, page, page_size, asset_type=type)
    if kind == "repositories":
        ops = (await db.scalars(select(Operation).where(Operation.kind == "repository.sync").order_by(Operation.created.desc()))).all()
        for r in result["items"]:
            op = next((v for v in ops if v.payload.get("resource", {}).get("id") == r["id"] and (v.payload["resource"]["version"] == r["version"] or v.state == "succeeded" and v.result.get("commit") == r["data"].get("commit"))), None)
            r["sync_operation"] = serialize(op) if op else None
    if kind == "modules":
        ops = (await db.scalars(select(Operation).where(Operation.kind.in_(["module.validate", "module.import"])).order_by(Operation.created.desc()))).all()
        for r in result["items"]:
            op = next((v for v in ops if v.kind == "module.validate" and v.payload.get("revision_id") == r["revision_id"]), None)
            r["availability"] = serialize(op) if op else None
            imported = next((v for v in ops if v.kind == "module.import" and v.payload.get("revision_id") == r["revision_id"]), None)
            r["import_operation"] = serialize(imported) if imported else None
    return result


@router.get("/{kind}/{resource_id}", response_model=ResourceResponse)
async def resource(kind: ResourceKind, resource_id: str, version: int | None = None, db=Depends(session)):
    return await get_resource(db, kind, resource_id, version)


@router.get("/{kind}/{resource_id}/versions", response_model=RevisionPageResponse)
async def versions(kind: ResourceKind, resource_id: str, db=Depends(session)):
    await get_resource(db, kind, resource_id)
    rows = (await db.scalars(select(Revision).where(Revision.resource_id == resource_id).order_by(Revision.number.desc()))).all()
    return {"items": [serialize(r) for r in rows]}


@router.post("/{kind}/{resource_id}/hide")
async def hide(kind: ResourceKind, resource_id: str, db=Depends(session)):
    await get_resource(db, kind, resource_id, lock=True)
    (await db.get(Resource, resource_id)).hidden = True
    return {"hidden": True}


@router.post("/{kind}/{resource_id}/restore")
async def restore(kind: ResourceKind, resource_id: str, db=Depends(session)):
    await get_resource(db, kind, resource_id, lock=True)
    (await db.get(Resource, resource_id)).hidden = False
    return {"hidden": False}
