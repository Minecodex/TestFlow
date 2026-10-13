from typing import Literal

from fastapi import APIRouter, Depends, Header, Query, Request
from pydantic import create_model
from sqlalchemy import select

from testflow.core.contracts import AssetBody, DatasetBody, EvaluationProfileBody, PipelineBody, RepositoryBody
from testflow.core.responses import ResourceResponse, ResourcePageResponse, RevisionPageResponse, OperationResponse
from testflow.core.dependencies import session
from testflow.core.errors import fail
from testflow.features.auth import cipher, require_admin, validate_credential
from testflow.features.datasets.validation import validate_dataset
from testflow.features.pipelines.service import resolve_graph, validate_graph
from testflow.infrastructure.models import Credential, Operation, Resource, Revision
from testflow.infrastructure.operations import enqueue, idempotent
from testflow.infrastructure.revisions import get_resource, list_resources, resource_changed, save_resource, serialize

ResourceKind = Literal["repositories", "modules", "assets", "datasets", "pipelines", "evaluation-profiles"]
router = APIRouter(dependencies=[Depends(require_admin)], tags=["resources"])


async def validate_body(db, kind, body, request=None):
    data = body.model_dump(mode="json")
    if kind == "evaluation-profiles" and body.api_key is not None:
        value = body.api_key.get_secret_value().strip()
        if not value or len(value) > 4096:
            fail("invalid_credential", "Enter a nonempty API key of at most 4096 characters")
        credential = Credential(name=body.name, kind="evaluation", encrypted=cipher(request).encrypt(value.encode()).decode())
        db.add(credential)
        await db.flush()
        data["credential_id"] = credential.id
    if kind in {"repositories", "evaluation-profiles"}:
        await validate_credential(db, data.get("credential_id"), "git" if kind == "repositories" else "evaluation")
    if kind == "pipelines":
        # Save drafts as versions; execution preflight requires a valid connected graph.
        resolved = await resolve_graph(db, body)
        data = {k: v for k, v in resolved.items() if k != "nodes"}
        data["nodes"] = [n.model_dump(mode="json") for n in body.nodes]
    if kind == "datasets":
        await validate_dataset(db, body)
    if kind == "assets" and body.type == "Text" and not body.blob:
        import hashlib
        content = body.text.encode("utf-8")
        data.update(size=len(content), sha256=hashlib.sha256(content).hexdigest(), format="UTF-8")
    if kind == "repositories":
        data.update(commit=None, commits=[], code_path=None, sync_state="not_synced", synced_at=None)
    return data


def install_writes(kind, model):
    update_model = create_model(kind.replace("-", "_") + "Update", expected_version=(int, ...), data=(model, ...))
    async def create(body, request: Request, db=Depends(session, scope="function")):
        if kind == "assets" and (body.type != "Text" or body.blob or body.original_blob or body.sha256 or body.metadata):
            fail("upload_required", "Create media using the validated upload endpoint")
        return await save_resource(db, kind, await validate_body(db, kind, body, request))
    async def update(resource_id: str, body, request: Request, db=Depends(session, scope="function")):
        data = await validate_body(db, kind, body.data, request)
        if kind == "assets":
            previous = await get_resource(db, kind, resource_id, body.expected_version)
            if body.data.type != previous["data"]["type"]:
                fail("immutable_asset_type", "Changing an asset type requires a new upload")
            for key in ["blob", "original_blob", "sha256", "size", "metadata", "type", "format", "source"]:
                data[key] = previous["data"][key]
            if previous["data"]["type"] == "Text":
                from testflow.features.assets.processing import store_blob
                content = body.data.text.encode("utf-8")
                blob, checksum = store_blob(request.app.state.settings.data_dir.resolve(), content, ".txt")
                data.update(text=body.data.text, blob=blob, sha256=checksum, size=len(content))
            else:
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
async def operation(operation_id: str, db=Depends(session, scope="function")):
    row = await db.get(Operation, operation_id)
    if not row: fail("not_found", "Operation not found", 404)
    return serialize(row)


@router.post("/pipelines/validate")
async def pipeline_validate(body: PipelineBody, db=Depends(session, scope="function")):
    graph = await resolve_graph(db, body)
    return {"valid": not (errors := validate_graph(graph)), "errors": errors, "graph": graph}


@router.post("/repositories/{resource_id}/sync", response_model=OperationResponse)
async def repository_sync(resource_id: str, idempotency_key: str = Header(..., min_length=1, max_length=128), db=Depends(session, scope="function")):
    async def create():
        repo = await get_resource(db, "repositories", resource_id)
        if repo["hidden"]: fail("hidden_resource", "Restore the repository first")
        return await enqueue(db, "repository.sync", {"resource": repo})
    return await idempotent(db, "repo.sync:" + resource_id, idempotency_key, {}, create)


@router.get("/{kind}", response_model=ResourcePageResponse)
async def resources(kind: ResourceKind, hidden: bool = False, search: str = "", type: Literal["Text", "Audio", "Image"] | None = None, page: int = Query(1, ge=1), page_size: int = Query(30, ge=1, le=100), db=Depends(session, scope="function")):
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
async def resource(kind: ResourceKind, resource_id: str, version: int | None = None, db=Depends(session, scope="function")):
    return await get_resource(db, kind, resource_id, version)


@router.get("/{kind}/{resource_id}/versions", response_model=RevisionPageResponse)
async def versions(kind: ResourceKind, resource_id: str, db=Depends(session, scope="function")):
    await get_resource(db, kind, resource_id)
    rows = (await db.scalars(select(Revision).where(Revision.resource_id == resource_id).order_by(Revision.number.desc()))).all()
    return {"items": [serialize(r) for r in rows]}


@router.post("/{kind}/{resource_id}/hide")
async def hide(kind: ResourceKind, resource_id: str, db=Depends(session, scope="function")):
    await get_resource(db, kind, resource_id, lock=True)
    resource = await db.get(Resource, resource_id)
    resource.hidden = True
    await resource_changed(db, kind, resource_id, resource.version, True)
    return {"hidden": True}
