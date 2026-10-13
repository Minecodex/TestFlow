from testflow.core.responses import ResourceResponse, OperationResponse
import hashlib
import io
import json
import stat
import zipfile
from pathlib import PurePosixPath

from fastapi import APIRouter, Depends, File, Header, Request, UploadFile
from fastapi.responses import FileResponse
from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError, ValidationError as JsonSchemaError
from pydantic import ValidationError
from sqlalchemy import select, text

from testflow.core.contracts import ModuleManifest, PodRuntime, Schema
from testflow.core.dependencies import session
from testflow.core.errors import fail
from testflow.features.auth import require_admin, validate_credential
from testflow.infrastructure.models import Operation, Resource, Revision
from testflow.infrastructure.operations import enqueue, idempotent
from testflow.infrastructure.revisions import digest, get_resource, save_resource
from testflow.features.modules.runtime_config import ModuleRuntimeUpdate, effective_runtime, validate_runtime

router = APIRouter(prefix="/modules", tags=["modules"], dependencies=[Depends(require_admin)])


@router.post("/manifest/validate", response_model=ModuleManifest)
async def validate_manifest(body: ModuleManifest):
    return body


def read_package(content: bytes, limit: int) -> dict:
    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
        infos = archive.infolist()
        paths = [PurePosixPath(f.filename) for f in infos]
        if len(infos) > 2000 or sum(i.file_size for i in infos) > limit or len(set(str(p) for p in paths)) != len(paths):
            fail("invalid_package", "Package is too large or contains duplicate paths")
        for info, path in zip(infos, paths):
            if path.is_absolute() or ".." in path.parts or "\\" in info.filename or stat.S_ISLNK(info.external_attr >> 16):
                fail("invalid_package", "Unsafe ZIP path")
        manifest = ModuleManifest.model_validate_json(archive.read("manifest.json"))
        required = [manifest.inputs, manifest.outputs, manifest.parameters, manifest.ui, "README.md"]
        if any(v not in archive.namelist() for v in required): fail("invalid_package", "Required package files are missing")
        inputs = Schema.model_validate_json(archive.read(manifest.inputs))
        outputs = Schema.model_validate_json(archive.read(manifest.outputs))
        parameters = json.loads(archive.read(manifest.parameters))
        if not isinstance(parameters, dict) or parameters.get("$schema", "https://json-schema.org/draft/2020-12/schema") != "https://json-schema.org/draft/2020-12/schema":
            fail("invalid_package", "Parameters must use a JSON Schema Draft 2020-12 object")
        def local_refs(value):
            if isinstance(value, dict):
                for keyword in ("$ref", "$dynamicRef"):
                    if keyword in value and (not isinstance(value[keyword], str) or not value[keyword].startswith("#")):
                        fail("invalid_package", "Parameter Schema references must stay inside the immutable package")
                for child in value.values(): local_refs(child)
            elif isinstance(value, list):
                for child in value: local_refs(child)
        local_refs(parameters)
        Draft202012Validator.check_schema(parameters)
        Draft202012Validator(parameters).validate(manifest.defaults)
        ui = archive.read(manifest.ui).decode("utf-8")
        if "testflow.ui.v1" not in ui or "export" not in ui:
            fail("incompatible_ui", "UI entry must export a testflow.ui.v1 component")
        return {"name": manifest.name, "manifest": manifest.model_dump(mode="json"), "runtime": manifest.runtime.model_dump(mode="json"), "inputs": inputs.model_dump(), "outputs": outputs.model_dump(), "parameters": parameters,
                "package_digest": hashlib.sha256(content).hexdigest(), "contract_digest": digest({"protocol": manifest.protocol, "id": manifest.id, "version": manifest.version, "inputs": inputs.model_dump(), "outputs": outputs.model_dump(), "parameters": parameters}),
                "readme": archive.read("README.md").decode("utf-8")}
    except (KeyError, zipfile.BadZipFile, UnicodeDecodeError, ValidationError, ValueError, SchemaError, JsonSchemaError) as error:
        fail("invalid_package", "Invalid ZIP manifest or schema", fields={"package": str(error)[:600]})


@router.post("/import", response_model=ResourceResponse)
async def import_module(request: Request, file: UploadFile = File(...), idempotency_key: str = Header(..., min_length=1, max_length=128), db=Depends(session, scope="function")):
    content = await file.read(request.app.state.settings.max_upload_bytes + 1)
    if len(content) > request.app.state.settings.max_upload_bytes: fail("upload_too_large", "Upload too large", 413)
    data = read_package(content, request.app.state.settings.max_upload_bytes)
    async def create():
        if db.bind.dialect.name == "postgresql":
            key = int.from_bytes(hashlib.sha256(data["manifest"]["id"].encode()).digest()[:8], "big", signed=True)
            await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})
        records = (await db.scalars(select(Resource).where(Resource.kind == "modules"))).all()
        family = None
        for r in records:
            current = await get_resource(db, "modules", r.id)
            if current["data"]["manifest"]["id"] == data["manifest"]["id"]:
                family = current
                versions = (await db.scalars(select(Revision).where(Revision.resource_id == r.id))).all()
                same = next((v for v in versions if v.data["manifest"]["version"] == data["manifest"]["version"]), None)
                if same:
                    if same.data["package_digest"] != data["package_digest"]: fail("version_identity_conflict", "Change module version when changing a package", 409)
                    resource = current if current["data"]["package_digest"] == data["package_digest"] else await get_resource(db, "modules", r.id, same.number)
                    operations = (await db.scalars(select(Operation).where(Operation.kind == "module.import").order_by(Operation.created.desc()))).all()
                    imported = next((op for op in operations if op.payload.get("revision_id") == same.id), None)
                    if imported and imported.state not in {"succeeded", "queued", "running"}:
                        imported = await enqueue(db, "module.import", {"resource_id": r.id, "revision_id": same.id, "package_digest": same.data["package_digest"]})
                        return {**resource, "operation_id": imported["id"]}
                    return {**resource, **({"operation_id": imported.id} if imported else {})}
                break
        directory = request.app.state.settings.data_dir.resolve() / "module-packages" / data["package_digest"]
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "module.zip").write_bytes(content)
        resource = await save_resource(db, "modules", data, family["id"] if family else None, family["version"] if family else None)
        operation = await enqueue(db, "module.import", {"resource_id": resource["id"], "revision_id": resource["revision_id"], "package_digest": data["package_digest"]})
        return {**resource, "operation_id": operation["id"]}
    return await idempotent(db, "module.import", idempotency_key, {"sha256": data["package_digest"]}, create)


@router.put("/{module_id}/runtime", response_model=ResourceResponse)
async def save_runtime(module_id: str, body: ModuleRuntimeUpdate, db=Depends(session, scope="function")):
    module = await get_resource(db, "modules", module_id, lock=True)
    if module["hidden"]:
        fail("hidden_module", "Deleted modules cannot be edited")
    if module["version"] != body.expected_version:
        fail("version_conflict", "Resource changed; reload before saving", 409)
    runtime = body.runtime.model_dump(mode="json")
    await validate_runtime(db, module["data"], runtime, require_visible=True)
    if effective_runtime(module["data"]) == runtime:
        return module
    return await save_resource(db, "modules", {**module["data"], "runtime": runtime}, module_id, body.expected_version)


@router.post("/{module_id}/validate", response_model=OperationResponse)
async def validate_module(module_id: str, request: Request, runtime: PodRuntime | None = None, version: int | None = None, idempotency_key: str = Header(..., min_length=1, max_length=128), db=Depends(session, scope="function")):
    async def create():
        module = await get_resource(db, "modules", module_id, version)
        if module["hidden"]: fail("hidden_module", "Restore module before validation")
        imports = (await db.scalars(select(Operation).where(Operation.kind == "module.import"))).all()
        importing = [op for op in imports if op.payload.get("package_digest") == module["data"]["package_digest"]]
        if importing and not any(op.state == "succeeded" for op in importing): fail("module_import_pending", "Wait for module import to finish", 409)
        actual = runtime.model_dump(mode="json") if runtime else effective_runtime(module["data"])
        repository = await validate_runtime(db, module["data"], actual, require_visible=True)
        payload = {"module": module, "revision_id": module["revision_id"], "runtime": actual}
        if repository:
            payload["repository"] = repository
        return await enqueue(db, "module.validate", payload)
    intent = {"version": version, "runtime": runtime.model_dump(mode="json") if runtime else None}
    return await idempotent(db, "module.validate:" + module_id, idempotency_key, intent, create)


@router.get("/{module_id}/files/{path:path}")
async def module_file(module_id: str, path: str, request: Request, version: int, db=Depends(session, scope="function")):
    module = await get_resource(db, "modules", module_id, version)
    root = request.app.state.settings.data_dir.resolve() / "module-packages" / module["data"]["package_digest"]
    target = (root / path).resolve()
    if not target.is_relative_to(root) or not target.is_file(): fail("not_found", "Package file not found", 404)
    return FileResponse(target, media_type="text/javascript" if target.suffix == ".js" else None, headers={"Cache-Control": "private, max-age=31536000, immutable"})


async def finish_import(app, payload):
    directory = app.state.settings.data_dir.resolve() / "module-packages" / payload["package_digest"]
    content = (directory / "module.zip").read_bytes()
    data = read_package(content, app.state.settings.max_upload_bytes)
    if data["package_digest"] != payload["package_digest"]: raise RuntimeError("Stored ZIP digest changed")
    import asyncio
    def extract():
        with zipfile.ZipFile(io.BytesIO(content)) as archive: archive.extractall(directory)
    await asyncio.to_thread(extract)
    return {"resource_id": payload["resource_id"], "revision_id": payload["revision_id"], "package_digest": data["package_digest"], "imported": True}
