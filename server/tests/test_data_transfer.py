from copy import deepcopy
import hashlib
import io
import json
import wave
import zipfile

from PIL import Image
import pytest

from testflow.features.assets.transfer import pack_assets
from testflow.features.assets.transfer_contracts import AssetPackage


def fixture_package():
    wav = io.BytesIO()
    with wave.open(wav, "wb") as audio:
        audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(16000)
        audio.writeframes(b"\x00\x00" * 1600)
    png = io.BytesIO(); Image.new("RGB", (12, 10), "white").save(png, "PNG")
    files = {"files/question.txt": b"What is the refund policy?", "files/question.wav": wav.getvalue(), "files/question.png": png.getvalue()}
    assets = []
    for index, (path, value) in enumerate(files.items()):
        kind = ["Text", "Audio", "Image"][index]
        assets.append({"key": kind.lower(), "name": "Example " + kind, "type": kind,
            "format": {"Text": "UTF-8", "Audio": "WAV · 16kHz · Mono", "Image": "Image/*"}[kind],
            "file": {"path": path, "sha256": hashlib.sha256(value).hexdigest(), "size": len(value)},
            "tags": ["example"], "category": "Helpdesk", "reference": "14 days", "reference_confirmed": True, "source": "synthetic-example"})
        assets[-1]["metadata"] = {"description": "Synthetic fixture", "truncated": False}
    document = AssetPackage.model_validate({"format": "testflow.assets.v1", "assets": assets})
    return document, files


async def upload(client, path, content, key=None):
    return await client.post("/api/v1/assets/" + path, files={"file": ("pool.zip", content, "application/zip")},
                            headers={"Idempotency-Key": key} if key else {})


async def test_pool_validates_then_imports_and_reuses_fixed_revisions(app_client):
    _, client = app_client
    document, files = fixture_package()
    package = pack_assets(document, files)
    result = await upload(client, "import/preview", package)
    assert result.status_code == 200 and all(i["state"] == "create" for i in result.json()["items"]), result.text
    assert (await client.get("/api/v1/assets")).json()["total"] == 0
    imported = await upload(client, "import", package, "pool")
    assert imported.status_code == 200 and imported.json()["created"] == 3, imported.text
    repeated = await upload(client, "import", package, "pool")
    assert repeated.json() == imported.json()
    reused = await upload(client, "import", package, "another-key")
    assert reused.json()["created"] == 0 and reused.json()["reused"] == 3
    exports = []
    for item in imported.json()["items"]:
        asset = (await client.get("/api/v1/assets/" + item["resource"]["id"])).json()
        assert asset["data"]["tags"] == ["example"] and asset["data"]["reference_confirmed"]
        assert asset["data"]["metadata"]["description"] == "Synthetic fixture"
        media = await client.get("/api/v1/media/" + asset["id"])
        expected = files[next(p for p in files if p.endswith({"Text": ".txt", "Audio": ".wav", "Image": ".png"}[asset["data"]["type"]]))]
        assert media.content == expected
        exports.append(item["resource"])
    exported = await client.post("/api/v1/assets/export", json={"assets": exports})
    assert exported.status_code == 200 and exported.headers["content-type"] == "application/zip", exported.text[:200] if exported.status_code != 200 else ""
    with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
        manifest = archive.read("manifest.json").decode()
        for selected in exports:
            assert selected["id"] not in manifest
        assert '"blob"' not in manifest
    assert (await upload(client, "import", exported.content, "export-reimport")).json()["reused"] == 3
    body = deepcopy(asset["data"]); body["tags"] = ["edited"]
    assert (await client.put("/api/v1/assets/" + asset["id"], json={"expected_version": 1, "data": body})).status_code == 200
    again = await upload(client, "import/preview", package)
    assert all(i["resource"]["version"] == 1 for i in again.json()["items"])
    await client.post("/api/v1/assets/" + asset["id"] + "/hide")
    assert (await upload(client, "import/preview", package)).json()["items"][-1]["state"] == "create"
    assert (await client.get("/api/v1/media/" + asset["id"] + "?version=1")).status_code == 200


@pytest.mark.parametrize("mutation", ["hash", "path", "extra", "duplicate", "invalid_media", "format", "truncated"])
async def test_invalid_pool_is_atomic(app_client, mutation):
    _, client = app_client
    doc, files = fixture_package()
    value = doc.model_dump(mode="json")
    if mutation == "hash":
        value["assets"][-1]["file"]["sha256"] = "0" * 64
    elif mutation == "path":
        value["assets"][-1]["file"]["path"] = "../escape.png"
    elif mutation == "extra":
        files["../escape.txt"] = b"unsafe"
    elif mutation == "invalid_media":
        files["files/question.png"] = b"invalid"
        value["assets"][-1]["file"].update(sha256=hashlib.sha256(b"invalid").hexdigest(), size=7)
    elif mutation == "format":
        value["format"] = "wrong"
    elif mutation == "truncated":
        value["assets"][1]["file"].update(sha256=hashlib.sha256(files["files/question.wav"][:-10]).hexdigest(), size=len(files["files/question.wav"])-10)
        files["files/question.wav"] = files["files/question.wav"][:-10]
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("manifest.json", json.dumps(value))
        for path, content in files.items(): archive.writestr(path, content)
        if mutation == "duplicate": archive.writestr("files/question.txt", b"duplicate")
    result = await upload(client, "import", buffer.getvalue(), "invalid")
    assert result.status_code == 422, result.text
    assert (await client.get("/api/v1/assets")).json()["total"] == 0


async def test_dataset_dependency_export_import_and_idempotency(app_client):
    _, client = app_client
    doc, files = fixture_package()
    assets = (await upload(client, "import", pack_assets(doc, files), "assets")).json()["items"]
    schema = {"fields": [{"name": "question", "type": "Text", "format": "UTF-8", "stream": False},
        {"name": "photo", "type": "Image", "format": "Image/*", "stream": False}]}
    body = {"name": "Multimodal", "input_schema": schema, "cases": [
        {"id": "old-case", "name": "Question", "inputs": {"question": {"asset_id": assets[0]["resource"]["id"], "asset_version": 1},
            "photo": {"asset_id": assets[2]["resource"]["id"], "asset_version": 1}}}]}
    created = (await client.post("/api/v1/datasets", json=body)).json()
    exported = await client.get("/api/v1/datasets/" + created["id"] + "/export?version=1")
    assert exported.status_code == 200, exported.text
    document = exported.json()
    for identity in [created["id"], "old-case", *(a["resource"]["id"] for a in assets)]:
        assert identity not in exported.text
    imported = {"document": document, "name": "Copied dataset"}
    preview = await client.post("/api/v1/datasets/import/preview", json=imported)
    assert preview.status_code == 200 and preview.json()["valid"], preview.text
    headers = {"Idempotency-Key": "dataset"}
    result = await client.post("/api/v1/datasets/import", json=imported, headers=headers)
    assert result.status_code == 200, result.text
    assert result.json()["data"]["input_schema"] == schema
    assert result.json()["data"]["cases"][0]["id"] != "old-case"
    assert (await client.post("/api/v1/datasets/import", json=imported, headers=headers)).json()["id"] == result.json()["id"]
    imported["name"] = "Changed"
    assert (await client.post("/api/v1/datasets/import", json=imported, headers=headers)).status_code == 409
    imported["bindings"] = {document["assets"][0]["key"]: {"id": "does-not-exist"}}
    invalid = await client.post("/api/v1/datasets/import/preview", json=imported)
    assert invalid.status_code == 200 and not invalid.json()["valid"]
    imported.pop("bindings")
    await client.post("/api/v1/assets/" + assets[2]["resource"]["id"] + "/hide")
    assert not (await client.post("/api/v1/datasets/import/preview", json=imported)).json()["valid"]
    assert (await client.post("/api/v1/datasets/import", json=imported, headers={"Idempotency-Key": "hidden"})).status_code == 422


async def test_dataset_literal_types_and_fixed_reference_revisions(app_client):
    _, client = app_client
    doc, files = fixture_package()
    assets = (await upload(client, "import", pack_assets(doc, files), "pool")).json()["items"]
    text = doc.assets[0]
    document = {"format": "testflow.dataset.v1", "assets": [{"key": "text", "name": text.name, "type": text.type,
        "format": text.format, "sha256": text.file.sha256, "revision_digest": text.revision_digest()}], "dataset": {
        "name": "Fixed", "input_schema": {"fields": [{"name": "query", "type": "Text", "format": "UTF-8"}]},
        "cases": [{"key": "one", "name": "One", "inputs": {"query": {"asset_key": "text"}}}]}}
    original = (await client.get("/api/v1/assets/" + assets[0]["resource"]["id"])).json()
    data = {**original["data"], "reference": "New reference"}
    await client.put("/api/v1/assets/" + original["id"], json={"expected_version": 1, "data": data})
    result = await client.post("/api/v1/datasets/import/preview", json={"document": document})
    assert result.json()["valid"] and result.json()["dataset"]["cases"][0]["inputs"]["query"]["asset_version"] == 1
    # A mismatching explicit current revision cannot fall back to an older match.
    selected = {"document": document, "bindings": {"text": {"id": original["id"], "version": 2}}}
    assert not (await client.post("/api/v1/datasets/import/preview", json=selected)).json()["valid"]
    document["assets"] = []
    document["dataset"]["cases"][0]["inputs"]["query"] = {"value": 42}
    assert not (await client.post("/api/v1/datasets/import/preview", json={"document": document})).json()["valid"]


async def test_audio_original_and_annotation_metadata_round_trip(app_client, monkeypatch):
    _, client = app_client
    # The unit test isolates the external decoder; Kubernetes verifies real FFmpeg.
    from testflow.features.assets.processing import audio_metadata
    async def decoder(content, extension):
        assert extension == ".wav"
        return content, audio_metadata(content)
    monkeypatch.setattr("testflow.features.assets.transfer.transcode_audio", decoder)
    document, files = fixture_package()
    original = files["files/question.wav"]
    value = document.model_dump(mode="json")
    value["assets"][1]["original"] = {"path": "originals/question.wav", "sha256": hashlib.sha256(original).hexdigest(), "size": len(original)}
    files["originals/question.wav"] = original
    package = pack_assets(AssetPackage.model_validate(value), files)
    imported = await upload(client, "import", package, "original")
    assert imported.status_code == 200, imported.text
    audio = imported.json()["items"][1]["resource"]
    raw = await client.get(f"/api/v1/media/{audio['id']}?version=1&original=true")
    assert raw.content == original
    exported = await client.post("/api/v1/assets/export", json={"assets": [audio]})
    assert exported.status_code == 200
    with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        entry = manifest["assets"][0]
        assert archive.read(entry["original"]["path"]) == original
        assert entry["metadata"] == {"description": "Synthetic fixture", "truncated": False}
        assert "sample_rate" not in entry["metadata"]
    assert (await upload(client, "import", exported.content, "original-copy")).json()["reused"] == 1


async def test_utf8_bom_upload_exports_canonical_text(app_client):
    _, client = app_client
    response = await client.post("/api/v1/media/upload", files={"files": ("text.txt", b"\xef\xbb\xbfhello", "text/plain")})
    resource = response.json()["items"][0]["resource"]
    assert resource["data"]["text"] == "hello"
    assert resource["data"]["sha256"] == hashlib.sha256(b"hello").hexdigest()
    exported = await client.post("/api/v1/assets/export", json={"assets": [{"id": resource["id"], "version": 1}]})
    assert exported.status_code == 200
    assert (await upload(client, "import", exported.content, "bom")).json()["reused"] == 1
