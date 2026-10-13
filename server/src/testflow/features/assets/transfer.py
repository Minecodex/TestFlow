"""Portable assets contain validated bytes and annotations, never storage paths or IDs."""
import hashlib
import io
import json
from pathlib import Path
import stat
import zipfile

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select, text

from testflow.core.contracts import AssetBody
from testflow.core.errors import fail
from testflow.features.assets.processing import AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, audio_metadata, image_metadata, store_blob, transcode_audio
from testflow.features.assets.transfer_contracts import AssetPackage, AssetPreview, AssetImportItem, PortableAsset, ResourceSelection
from testflow.infrastructure.models import Resource, Revision
from testflow.infrastructure.revisions import save_resource


def read_blob(root, relative):
    target = (root / (relative or "")).resolve()
    if not target.is_relative_to(root / "assets") or not target.is_file():
        fail("missing_asset_file", "The fixed asset file is unavailable", 404)
    return target.read_bytes()


def describe_asset(data, root, key="asset"):
    files = {}
    content = data["text"].encode("utf-8") if data["type"] == "Text" else read_blob(root, data.get("blob"))
    sha = hashlib.sha256(content).hexdigest()
    if data.get("sha256") != sha:
        fail("asset_integrity_error", "Asset bytes do not match the stored digest", 409)
    extension = ".txt" if data["type"] == "Text" else Path(data["blob"]).suffix.lower()
    path = "files/" + sha + extension
    files[path] = content
    value = {field: data.get(field) for field in ["name", "type", "format", "tags", "category", "reference", "reference_confirmed", "source"]}
    reserved = {"execution_id", "runtime_id", "width", "height", "encoding", "sample_rate", "channels", "frames", "duration"}
    value["metadata"] = {k: v for k, v in data.get("metadata", {}).items() if k not in reserved}
    value.update(key=key, file={"path": path, "sha256": sha, "size": len(content)})
    if data.get("original_blob"):
        original = read_blob(root, data["original_blob"])
        original_sha = hashlib.sha256(original).hexdigest()
        path = "originals/" + original_sha + Path(data["original_blob"]).suffix.lower()
        files[path] = original
        value["original"] = {"path": path, "sha256": original_sha, "size": len(original)}
    return PortableAsset.model_validate(value), files


def pack_assets(document, files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        values = {"manifest.json": (json.dumps(document.model_dump(mode="json"), ensure_ascii=False, indent=2) + "\n").encode(), **files}
        for path, value in sorted(values.items()):
            info = zipfile.ZipInfo(path, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, value)
    return output.getvalue()


async def parse_package(content, limit):
    if not content or len(content) > limit:
        fail("upload_too_large", "Empty or oversized asset package", 413)
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            entries = archive.infolist()
            names = [item.filename for item in entries]
            if len(entries) > 2001 or len(set(names)) != len(names) or sum(e.file_size for e in entries) > limit:
                fail("invalid_asset_package", "Duplicate files, too many entries or oversized uncompressed package")
            if any(e.is_dir() or e.flag_bits & 1 or stat.S_ISLNK(e.external_attr >> 16) for e in entries):
                fail("invalid_asset_package", "Directories, encryption and symbolic links are not supported")
            if "manifest.json" not in names or archive.getinfo("manifest.json").file_size > 4 * 1024 * 1024:
                fail("invalid_asset_package", "A manifest.json of at most 4 MiB is required")
            document = AssetPackage.model_validate_json(archive.read("manifest.json"))
            expected = {"manifest.json"}
            descriptors = [f for a in document.assets for f in [a.file, a.original] if f]
            expected.update(f.path for f in descriptors)
            if set(names) != expected:
                fail("invalid_asset_package", "Package files must exactly match the manifest")
            files = {path: archive.read(path) for path in expected if path != "manifest.json"}
            for f in descriptors:
                if len(files[f.path]) != f.size or hashlib.sha256(files[f.path]).hexdigest() != f.sha256:
                    fail("asset_checksum_mismatch", "An asset checksum or size does not match the manifest", fields={f.path: "checksum"})
    except (zipfile.BadZipFile, KeyError, ValidationError, UnicodeDecodeError, ValueError, RuntimeError):
        fail("invalid_asset_package", "Invalid ZIP or asset manifest")
    prepared = []
    for asset in document.assets:
        value = files[asset.file.path]
        extension = Path(asset.file.path).suffix.lower()
        text_value, metadata = None, {}
        if asset.type == "Text":
            if extension != ".txt":
                fail("invalid_text", "Portable text files must use .txt")
            try:
                text_value = value.decode("utf-8")
            except UnicodeDecodeError:
                fail("invalid_text", "Text must use UTF-8")
        elif asset.type == "Image":
            if extension not in IMAGE_EXTENSIONS:
                fail("invalid_image", "Unsupported image extension")
            metadata = image_metadata(value)
        else:
            if extension != ".wav":
                fail("invalid_audio", "Canonical audio must use .wav")
            metadata = audio_metadata(value)
            if asset.original:
                original_extension = Path(asset.original.path).suffix.lower()
                if original_extension not in AUDIO_EXTENSIONS:
                    fail("invalid_audio", "Unsupported original audio extension")
                await transcode_audio(files[asset.original.path], original_extension)
        body = {k: v for k, v in asset.model_dump(mode="json").items() if k not in {"key", "file", "original"}}
        body.update(text=text_value, metadata={**asset.metadata, **metadata}, sha256=asset.file.sha256, size=asset.file.size)
        prepared.append(AssetBody.model_validate(body).model_dump(mode="json"))
    return document, files, prepared


async def asset_candidates(db, root, checksums):
    rows = (await db.execute(select(Resource.id, Revision.number, Revision.data)
        .join(Revision, Resource.id == Revision.resource_id)
        .where(Resource.kind == "assets", Resource.hidden.is_(False), Revision.data["sha256"].as_string().in_(checksums))
        .order_by(Resource.created, Resource.id, Revision.number))).all()
    candidates = {}
    for identity, version, data in rows:
        try:
            portable, _ = describe_asset(data, root)
            candidates.setdefault(portable.revision_digest(), []).append({"id": identity, "version": version, "name": data["name"]})
        except HTTPException:
            # Missing historical files cannot satisfy a portable dependency.
            continue
    return candidates


async def preview_assets(db, root, document):
    candidates = await asset_candidates(db, root, {a.file.sha256 for a in document.assets})
    items = []
    for a in document.assets:
        match = candidates.get(a.revision_digest(), [])
        items.append(AssetImportItem(key=a.key, name=a.name, type=a.type, revision_digest=a.revision_digest(),
                                     state="reuse" if match else "create", resource=ResourceSelection(id=match[0]["id"], version=match[0]["version"]) if match else None))
    return AssetPreview(items=items)


async def import_assets(db, root, document, files, prepared):
    # Different import keys sharing identical revisions still deduplicate atomically.
    if db.bind.dialect.name == "postgresql":
        for checksum in sorted({a.file.sha256 for a in document.assets}):
            await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": int(checksum[:15], 16)})
    preview = await preview_assets(db, root, document)
    created, reused, seen = 0, 0, {}
    for item, asset, body in zip(preview.items, document.assets, prepared, strict=True):
        if item.resource or item.revision_digest in seen:
            item.resource = item.resource or seen[item.revision_digest]
            item.state = "reuse"
            reused += 1
        else:
            body["blob"], _ = store_blob(root, files[asset.file.path], Path(asset.file.path).suffix.lower())
            if asset.original:
                body["original_blob"], _ = store_blob(root, files[asset.original.path], Path(asset.original.path).suffix.lower())
            resource = await save_resource(db, "assets", body)
            item.resource = {"id": resource["id"], "version": resource["selected_version"]}
            created += 1
        item.resource = ResourceSelection.model_validate(item.resource)
        seen[item.revision_digest] = item.resource
    return {"items": [i.model_dump(mode="json") for i in preview.items], "created": created, "reused": reused}
