import hashlib
import json

from fastapi import APIRouter, Depends, File, Header, Request, UploadFile
from fastapi.responses import Response

from testflow.core.dependencies import session
from testflow.core.errors import fail
from testflow.features.auth import require_admin
from testflow.features.assets.transfer import describe_asset, import_assets, pack_assets, parse_package, preview_assets
from testflow.features.assets.transfer_contracts import AssetExport, AssetImportResult, AssetPackage, AssetPreview
from testflow.infrastructure.operations import idempotent
from testflow.infrastructure.revisions import get_resource

router = APIRouter(prefix="/assets", tags=["asset-packages"], dependencies=[Depends(require_admin)])


@router.post("/export", responses={200: {"content": {"application/zip": {"schema": {"type": "string", "format": "binary"}}}}}, response_class=Response)
async def export_assets(body: AssetExport, request: Request, db=Depends(session, scope="function")):
    root, assets, files = request.app.state.settings.data_dir.resolve(), [], {}
    for i, selected in enumerate(body.assets):
        resource = await get_resource(db, "assets", selected.id, selected.version)
        asset, content = describe_asset(resource["data"], root, "asset-" + str(i + 1))
        assets.append(asset)
        files.update(content)
    document = AssetPackage(format="testflow.assets.v1", assets=assets)
    manifest_size = len((json.dumps(document.model_dump(mode="json"), ensure_ascii=False, indent=2) + "\n").encode())
    limit = request.app.state.settings.max_upload_bytes
    if manifest_size > 4 * 1024 * 1024 or sum(len(c) for c in files.values()) + manifest_size > limit:
        fail("package_too_large", "Select fewer assets to keep the package within the upload limit", 413)
    content = pack_assets(document, files)
    if len(content) > limit:
        fail("package_too_large", "Select fewer assets to keep the ZIP within the upload limit", 413)
    return Response(content, media_type="application/zip", headers={"Content-Disposition": 'attachment; filename="testflow-assets.zip"'})


async def read_package(request, file):
    limit = request.app.state.settings.max_upload_bytes
    return await file.read(limit + 1)


@router.post("/import/preview", response_model=AssetPreview)
async def preview(request: Request, file: UploadFile = File(...), db=Depends(session, scope="function")):
    document, _, _ = await parse_package(await read_package(request, file), request.app.state.settings.max_upload_bytes)
    return await preview_assets(db, request.app.state.settings.data_dir.resolve(), document)


@router.post("/import", response_model=AssetImportResult)
async def import_package(request: Request, file: UploadFile = File(...), idempotency_key: str = Header(..., min_length=1, max_length=128), db=Depends(session, scope="function")):
    content = await read_package(request, file)
    document, files, prepared = await parse_package(content, request.app.state.settings.max_upload_bytes)
    async def create():
        return await import_assets(db, request.app.state.settings.data_dir.resolve(), document, files, prepared)
    return await idempotent(db, "assets.import", idempotency_key, {"sha256": hashlib.sha256(content).hexdigest()}, create)
