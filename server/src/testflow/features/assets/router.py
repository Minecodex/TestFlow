from pathlib import Path

from fastapi import APIRouter, Depends, File, Request, UploadFile
from fastapi.responses import FileResponse

from testflow.core.contracts import AssetBody
from testflow.core.dependencies import session
from testflow.core.errors import fail
from testflow.features.auth import require_admin
from testflow.infrastructure.revisions import get_resource, save_resource
from testflow.features.assets.processing import prepare_upload

router = APIRouter(prefix="/media", tags=["media"], dependencies=[Depends(require_admin)])


@router.post("/upload")
async def upload(request: Request, files: list[UploadFile] = File(...), source: str = "upload", db=Depends(session, scope="function")):
    results = []
    root = request.app.state.settings.data_dir.resolve()
    for file in files:
        try:
            content = await file.read(request.app.state.settings.max_upload_bytes + 1)
            if not content or len(content) > request.app.state.settings.max_upload_bytes: fail("upload_too_large", "Empty or oversized upload", 413)
            filename = Path(file.filename or "upload").name
            data = await prepare_upload(root, content, filename, source, file.content_type or "")
            resource = await save_resource(db, "assets", AssetBody.model_validate(data).model_dump(mode="json"))
            results.append({"filename": filename, "resource": resource, "error": None})
        except Exception as error:
            from fastapi import HTTPException
            if isinstance(error, HTTPException): detail = error.detail
            else: detail = {"code": "media_error", "message": "Media processing failed; check FFmpeg availability"}
            results.append({"filename": file.filename, "resource": None, "error": detail})
    return {"items": results}


@router.get("/{asset_id}")
async def media(asset_id: str, request: Request, version: int | None = None, original: bool = False, db=Depends(session, scope="function")):
    asset = await get_resource(db, "assets", asset_id, version)
    relative = asset["data"].get("original_blob" if original else "blob")
    if not relative: fail("no_media", "This asset has no file", 404)
    root = request.app.state.settings.data_dir.resolve()
    target = (root / relative).resolve()
    if not target.is_relative_to(root / "assets") or not target.is_file(): fail("not_found", "Media file not found", 404)
    # Starlette FileResponse implements Range and conditional requests.
    import mimetypes
    content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
    return FileResponse(target, filename=asset["name"], media_type=content_type, content_disposition_type="inline",
                        headers={"Cache-Control": "private, max-age=31536000, immutable" if version is not None else "private, no-cache"})
