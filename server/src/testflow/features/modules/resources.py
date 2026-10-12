import hashlib

from fastapi import APIRouter, Depends, File, Header, Query, Request, UploadFile
from fastapi.responses import FileResponse

from testflow.core.contracts import AssetBody
from testflow.core.dependencies import session
from testflow.core.errors import fail
from testflow.features.assets.router import store_blob
from testflow.infrastructure.models import Execution, Runtime
from testflow.infrastructure.revisions import get_resource, save_resource

router = APIRouter(prefix="/module-resources", tags=["module resources"])


async def module_access(runtime_id: str, request: Request, execution_id: str = Query(...), authorization: str = Header(""), db=Depends(session)):
    runtime = await db.get(Runtime, runtime_id)
    execution = await db.get(Execution, execution_id)
    if not runtime or runtime.state != "ready" or not authorization.startswith("Bearer "):
        fail("module_unauthorized", "Module resource credential is invalid", 401)
    expected = request.app.state.pods.decrypted(runtime.token)
    import secrets
    if not secrets.compare_digest(authorization[7:], expected): fail("module_unauthorized", "Module resource credential is invalid", 401)
    if not execution or execution.batch_id != runtime.batch_id or runtime_id not in {n.get("runtime_id") for n in execution.nodes.values()}:
        fail("module_forbidden", "Invocation does not belong to this runtime", 403)
    if execution.cleanup in {"stopped", "timed_out", "interrupted"}:
        fail("module_forbidden", "Invocation resource access ended after cleanup", 403)
    return runtime, execution


def group_asset_ids(schema, values):
    """Only declared material fields grant access; JSON and reference annotations do not."""
    result = set()
    for field in (schema or {}).get("fields", []):
        if field["type"] == "JSON": continue
        value = values.get(field["name"])
        if not isinstance(value, dict): continue
        if value.get("asset_id") and type(value.get("asset_version")) is int:
            result.add((value["asset_id"], value["asset_version"]))
        asset = value.get("asset")
        if isinstance(asset, dict) and asset.get("id") and type(asset.get("selected_version")) is int:
            result.add((asset["id"], asset["selected_version"]))
    return result


def invocation_asset_ids(execution):
    graph = execution.snapshot["pipeline"]["graph"]
    schema = graph.get("input_schema", {})
    result = group_asset_ids(schema, execution.snapshot.get("inputs", {})) | group_asset_ids(schema, execution.actual_inputs)
    for node in graph["nodes"]:
        recorded = execution.nodes.get(node["id"], {})
        result |= group_asset_ids(node.get("input_schema"), recorded.get("input", {}))
        result |= group_asset_ids(node.get("output_schema"), recorded.get("output", {}))
    return result


@router.get("/{runtime_id}/assets/{asset_id}")
async def read_input(runtime_id: str, asset_id: str, version: int, request: Request, access=Depends(module_access), db=Depends(session)):
    runtime, execution = access
    asset = await get_resource(db, "assets", asset_id, version)
    allowed = invocation_asset_ids(execution)
    produced = asset["data"].get("metadata", {}).get("execution_id") == execution.id
    if (asset_id, version) not in allowed and not produced: fail("module_forbidden", "Asset is outside invocation scope", 403)
    root = request.app.state.settings.data_dir.resolve()
    path = (root / asset["data"]["blob"]).resolve()
    if not path.is_relative_to(root / "assets") or not path.is_file(): fail("not_found", "Asset file missing", 404)
    return FileResponse(path)


@router.post("/{runtime_id}/assets")
async def write_output(runtime_id: str, request: Request, type: str, format: str, file: UploadFile = File(...), access=Depends(module_access), db=Depends(session)):
    runtime, execution = access
    content = await file.read(request.app.state.settings.max_upload_bytes + 1)
    if not content or len(content) > request.app.state.settings.max_upload_bytes: fail("upload_too_large", "Empty or oversized output", 413)
    from pathlib import Path
    from testflow.features.assets.router import transcode_audio
    import io
    metadata = {"runtime_id": runtime_id, "execution_id": execution.id}
    extension = ".bin"
    if type == "Audio":
        content, details = await transcode_audio(content, Path(file.filename or "output.wav").suffix or ".wav")
        metadata.update(details); extension = ".wav"
        if format != "WAV · 16kHz · Mono": fail("output_format", "Audio output must match normalized WAV format")
    elif type == "Image":
        from PIL import Image
        with Image.open(io.BytesIO(content)) as image:
            image.verify()
        if format != "Image/*": fail("output_format", "Image format mismatch")
        with Image.open(io.BytesIO(content)) as image:
            metadata.update(width=image.width, height=image.height, encoding=image.format)
            extension = ".png" if image.format == "PNG" else ".jpg" if image.format == "JPEG" else "." + image.format.lower()
    else: fail("output_type", "This endpoint accepts Audio and Image products")
    blob, sha = store_blob(request.app.state.settings.data_dir.resolve(), content, extension)
    resource = await save_resource(db, "assets", AssetBody(name=file.filename or "Module output", type=type, format=format, blob=blob, sha256=sha, size=len(content), metadata=metadata, source="module_output").model_dump(mode="json"))
    return {"asset_id": resource["id"], "asset_version": resource["version"], "sha256": sha}


@router.get("/{runtime_id}/credentials/{credential_id}")
async def read_credential(runtime_id: str, credential_id: str, request: Request, access=Depends(module_access), db=Depends(session)):
    from testflow.features.auth import credential_value, validate_credential
    from testflow.infrastructure.redaction import credential_refs, credential_strings
    runtime, execution = access
    node_ids = {key for key, node in execution.nodes.items() if node.get("runtime_id") == runtime_id}
    allowed = set()
    for node in execution.snapshot["pipeline"]["graph"]["nodes"]:
        if node["id"] in node_ids and node.get("module_snapshot"):
            allowed |= credential_refs(node["module_snapshot"]["data"]["parameters"], node["parameters"])
    if credential_id not in allowed: fail("module_forbidden", "Credential is outside the declared invocation parameter scope", 403)
    await validate_credential(db, credential_id, "module")
    value = await credential_value(db, request.app.state.settings, credential_id)
    request.app.state.secret_values.setdefault(execution.id, set()).update(credential_strings(value))
    return {"credential_id": credential_id, "value": value}


async def validate_output_reference(app, execution_id, spec, value):
    if not isinstance(value, dict) or not isinstance(value.get("asset_id"), str) or type(value.get("asset_version")) is not int or value["asset_version"] < 1:
        raise RuntimeError("Module media output requires an asset ID and immutable version")
    async with app.state.database.sessions() as db:
        ex = await db.get(Execution, execution_id)
        if not ex:
            raise RuntimeError("Module output belongs to an unknown invocation")
        asset = await get_resource(db, "assets", value["asset_id"], value["asset_version"])
        allowed = invocation_asset_ids(ex)
        produced = asset["data"].get("metadata", {}).get("execution_id") == execution_id
        if (value["asset_id"], value["asset_version"]) not in allowed and not produced:
            raise RuntimeError("Module output references media outside this invocation")
        if asset["data"]["type"] != spec["type"] or asset["data"]["format"] != spec["format"]:
            raise RuntimeError("Module output media type or format differs from its contract")
