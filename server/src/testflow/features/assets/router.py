import asyncio
import hashlib
import io
import json
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, Request, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError

from testflow.core.contracts import AssetBody
from testflow.core.dependencies import session
from testflow.core.errors import fail
from testflow.features.auth import require_admin
from testflow.infrastructure.revisions import get_resource, save_resource

router = APIRouter(prefix="/media", tags=["media"], dependencies=[Depends(require_admin)])


async def transcode_audio(content, extension):
    with tempfile.TemporaryDirectory(prefix="testflow-audio-") as directory:
        source, target = Path(directory) / ("input" + extension), Path(directory) / "output.wav"
        source.write_bytes(content)
        process = await asyncio.create_subprocess_exec("ffmpeg", "-nostdin", "-v", "error", "-i", str(source), "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(target), stderr=asyncio.subprocess.PIPE)
        try:
            async with asyncio.timeout(60): await process.communicate()
        except BaseException:
            process.kill(); await process.wait(); raise
        if process.returncode: fail("invalid_audio", "Audio cannot be decoded")
        import wave
        with wave.open(str(target)) as audio:
            metadata = {"sample_rate": audio.getframerate(), "channels": audio.getnchannels(), "encoding": "pcm_s16le", "frames": audio.getnframes(), "duration": audio.getnframes() / audio.getframerate()}
        return target.read_bytes(), metadata


def store_blob(root: Path, content: bytes, extension: str):
    identity = hashlib.sha256(content).hexdigest()
    relative = "assets/" + identity + extension
    path = root / relative
    if not path.exists(): path.write_bytes(content)
    return relative, identity


@router.post("/upload")
async def upload(request: Request, files: list[UploadFile] = File(...), source: str = "upload", db=Depends(session)):
    results = []
    root = request.app.state.settings.data_dir.resolve()
    for file in files:
        try:
            content = await file.read(request.app.state.settings.max_upload_bytes + 1)
            if not content or len(content) > request.app.state.settings.max_upload_bytes: fail("upload_too_large", "Empty or oversized upload", 413)
            filename = Path(file.filename or "upload").name
            extension = Path(filename).suffix.lower()
            data = {"name": filename, "source": source, "size": len(content)}
            if extension in {".txt", ".md", ".json"} or (file.content_type or "").startswith("text/"):
                try: value = content.decode("utf-8-sig")
                except UnicodeDecodeError: fail("invalid_text", "Text must use UTF-8")
                data.update(type="Text", text=value, format="UTF-8")
            elif extension in {".png", ".jpg", ".jpeg", ".webp", ".gif"}:
                try:
                    with Image.open(io.BytesIO(content)) as image:
                        image.verify()
                    with Image.open(io.BytesIO(content)) as image:
                        data.update(type="Image", format="Image/*", metadata={"width": image.width, "height": image.height, "encoding": image.format})
                except (UnidentifiedImageError, OSError, Image.DecompressionBombError): fail("invalid_image", "Invalid image")
            elif extension in {".wav", ".mp3", ".ogg", ".webm", ".m4a", ".flac"}:
                original, _ = store_blob(root, content, extension)
                content, metadata = await transcode_audio(content, extension)
                data.update(type="Audio", format="WAV · 16kHz · Mono", metadata=metadata, original_blob=original)
                extension = ".wav"
            else: fail("unsupported_media", "Supported uploads: UTF-8 text, images and audio")
            blob, sha = store_blob(root, content, extension)
            data.update(blob=blob, sha256=sha, size=len(content))
            resource = await save_resource(db, "assets", AssetBody.model_validate(data).model_dump(mode="json"))
            results.append({"filename": filename, "resource": resource, "error": None})
        except Exception as error:
            from fastapi import HTTPException
            if isinstance(error, HTTPException): detail = error.detail
            else: detail = {"code": "media_error", "message": "Media processing failed; check FFmpeg availability"}
            results.append({"filename": file.filename, "resource": None, "error": detail})
    return {"items": results}


@router.get("/{asset_id}")
async def media(asset_id: str, request: Request, version: int | None = None, original: bool = False, db=Depends(session)):
    asset = await get_resource(db, "assets", asset_id, version)
    relative = asset["data"].get("original_blob" if original else "blob")
    if not relative: fail("no_media", "This asset has no file", 404)
    root = request.app.state.settings.data_dir.resolve()
    target = (root / relative).resolve()
    if not target.is_relative_to(root / "assets") or not target.is_file(): fail("not_found", "Media file not found", 404)
    # Starlette FileResponse implements Range and conditional requests.
    return FileResponse(target, filename=asset["name"], content_disposition_type="inline", headers={"Cache-Control": "private, max-age=31536000, immutable"})
