from copy import deepcopy
import io
import json
from pathlib import Path
import zipfile

import pytest

from testflow.infrastructure.revisions import get_resource, save_resource

TEXT = {"fields": [{"name": "text", "type": "Text", "format": "UTF-8", "stream": False}]}


async def fixture(app, client):
    root = Path(__file__).resolve().parents[2]
    schema = {"type": "object", "properties": {"access": {"type": "array", "items": {"$ref": "#/$defs/access"}}},
              "required": ["access"], "additionalProperties": False,
              "$defs": {"access": {"type": "string", "x-testflow-credential": True}}}
    manifest = {"protocol": "testflow.module.v1", "id": "portable-text", "name": "Portable text", "version": "1.0.0",
                "defaults": {"access": ["configure-credential"]}, "runtime": {"mode": "pod", "image": "testflow/portable:v1"}}
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, value in {"manifest.json": manifest, "schemas/inputs.json": TEXT,
                            "schemas/outputs.json": TEXT, "schemas/parameters.json": schema}.items():
            archive.writestr(name, json.dumps(value))
        archive.writestr("ui/config-panel.js", (root / "examples/modules/common/ui.js").read_text())
        archive.writestr("README.md", "Portable fixture")
    imported = await client.post("/api/v1/modules/import", files={"file": ("module.zip", buffer.getvalue())},
                                 headers={"Idempotency-Key": "module"})
    assert imported.status_code == 200, imported.text
    module = imported.json()
    cred = (await client.post("/api/v1/credentials", json={"name": "Provider", "kind": "module", "value": "test-private-value"})).json()
    registry = (await client.post("/api/v1/credentials", json={"name": "Registry", "kind": "registry", "value": "registry-private-value"})).json()
    async with app.state.database.sessions() as db, db.begin():
        repo = await save_resource(db, "repositories", {"name": "Source", "url": "https://github.com/Minecodex/TestFlow.git",
                                                        "branch": "main", "commit": "a" * 40, "code_path": "repositories/fixed"})
    runtime = {**module["data"]["manifest"]["runtime"], "registry_credential_id": registry["id"],
               "code_mount": {"repository_id": repo["id"], "repository_version": 1, "commit": "a" * 40, "mount_path": "/workspace/code"}}
    graph = {"name": "Reusable", "input_schema": TEXT, "output_schema": TEXT, "nodes": [
        {"id": "start", "kind": "start", "name": "Start", "output_schema": TEXT},
        {"id": "module", "kind": "module", "name": "Process", "module_id": module["id"], "module_version": 1,
         "parameters": {"access": [cred["id"]]}, "runtime": runtime, "x": 200, "y": 100},
        {"id": "end", "kind": "end", "name": "End", "input_schema": TEXT, "output_schema": TEXT}],
        "edges": [{"source": "start", "target": "module"}, {"source": "module", "target": "end"}]}
    saved = await client.post("/api/v1/pipelines", json=graph)
    assert saved.status_code == 200, saved.text
    result = await client.get("/api/v1/pipelines/" + saved.json()["id"] + "/export?version=1")
    assert result.status_code == 200, result.text
    document = result.json()
    bindings = {r["key"]: {"id": cred["id"] if r["kind"] == "module" else registry["id"]} for r in document["credentials"]}
    return document, bindings, module, repo, saved.json()


async def test_portable_export_and_idempotent_import(app_client):
    app, client = app_client
    doc, bindings, module, repo, saved = await fixture(app, client)
    serialized = json.dumps(doc)
    assert doc["format"] == "testflow.workflow.v1"
    for forbidden in [module["id"], repo["id"], saved["id"], "test-private-value", "registry-private-value", "repositories/fixed"]:
        assert forbidden not in serialized
    node = doc["pipeline"]["nodes"][1]
    assert node["parameters"]["access"] == [None]
    assert node["parameter_credentials"][0]["path"] == ["access", 0]
    body = {"document": doc, "bindings": bindings, "name": "Imported"}
    preview = await client.post("/api/v1/pipelines/import/preview", json=body)
    assert preview.status_code == 200 and preview.json()["valid"], preview.text
    assert (await client.get("/api/v1/pipelines")).json()["total"] == 1
    headers = {"Idempotency-Key": "same-import"}
    first = await client.post("/api/v1/pipelines/import", json=body, headers=headers)
    assert first.status_code == 200, first.text
    second = await client.post("/api/v1/pipelines/import", json=body, headers=headers)
    assert first.json()["id"] == second.json()["id"]
    assert first.json()["data"]["nodes"][1]["runtime"]["code_mount"]["repository_id"] == repo["id"]
    module_key = next(r["key"] for r in doc["credentials"] if r["kind"] == "module")
    assert first.json()["data"]["nodes"][1]["parameters"]["access"][0] == bindings[module_key]["id"]
    assert (await client.get("/api/v1/pipelines/" + first.json()["id"] + "/export")).json()["modules"] == doc["modules"]
    body["name"] = "Different"
    assert (await client.post("/api/v1/pipelines/import", json=body, headers=headers)).status_code == 409


async def test_credentials_always_require_explicit_binding(app_client):
    app, client = app_client
    doc, _, _, _, _ = await fixture(app, client)
    body = {"document": doc}
    result = (await client.post("/api/v1/pipelines/import/preview", json=body)).json()
    assert not result["valid"]
    assert all(r["state"] == "selection_required" for r in result["requirements"] if r["kind"] == "credential")
    assert (await client.post("/api/v1/pipelines/import", json=body, headers={"Idempotency-Key": "missing"})).status_code == 422
    assert (await client.get("/api/v1/pipelines")).json()["total"] == 1


@pytest.mark.parametrize("mutation", ["digest", "commit", "hidden", "selection", "credential_kind"])
async def test_mismatching_dependencies_cannot_silently_fall_back(app_client, mutation):
    app, client = app_client
    doc, bindings, module, repo, _ = await fixture(app, client)
    if mutation == "digest":
        doc["modules"][0]["package_digest"] = "0" * 64
    elif mutation == "commit":
        doc["repositories"][0]["commit"] = "b" * 40
        doc["pipeline"]["nodes"][1]["runtime"]["code_mount"]["commit"] = "b" * 40
    elif mutation == "hidden":
        await client.post("/api/v1/modules/" + module["id"] + "/hide")
    elif mutation == "selection":
        bindings[doc["modules"][0]["key"]] = {"id": repo["id"], "version": 1}
    else:
        keys = [r["key"] for r in doc["credentials"]]
        bindings[keys[0]], bindings[keys[1]] = bindings[keys[1]], bindings[keys[0]]
    result = await client.post("/api/v1/pipelines/import/preview", json={"document": doc, "bindings": bindings})
    assert result.status_code == 200 and not result.json()["valid"], result.text


async def test_import_preserves_old_fixed_revisions(app_client):
    app, client = app_client
    doc, bindings, module, repo, _ = await fixture(app, client)
    async with app.state.database.sessions() as db, db.begin():
        data = deepcopy(module["data"])
        data["manifest"]["version"] = "2.0.0"
        await save_resource(db, "modules", data, module["id"], 1)
        data = {**repo["data"], "commit": "b" * 40}
        await save_resource(db, "repositories", data, repo["id"], 1)
    preview = await client.post("/api/v1/pipelines/import/preview", json={"document": doc, "bindings": bindings})
    assert preview.json()["valid"], preview.text
    node = preview.json()["pipeline"]["nodes"][1]
    assert node["module_version"] == node["runtime"]["code_mount"]["repository_version"] == 1


async def test_invalid_graph_format_and_credential_paths(app_client):
    app, client = app_client
    doc, bindings, _, _, _ = await fixture(app, client)
    broken = deepcopy(doc)
    broken["pipeline"]["edges"].append({"source": "end", "target": "start"})
    result = await client.post("/api/v1/pipelines/import/preview", json={"document": broken, "bindings": bindings})
    assert result.status_code == 200 and not result.json()["valid"] and result.json()["errors"]
    broken = deepcopy(doc)
    broken["pipeline"]["nodes"][1]["parameters"]["untrusted"] = None
    broken["pipeline"]["nodes"][1]["parameter_credentials"][0]["path"] = ["untrusted"]
    result = await client.post("/api/v1/pipelines/import/preview", json={"document": broken, "bindings": bindings})
    assert not result.json()["valid"] and result.json()["errors"][0]["code"] == "invalid_credential_path"
    broken = deepcopy(doc)
    broken["format"] = "unsupported"
    assert (await client.post("/api/v1/pipelines/import/preview", json={"document": broken})).status_code == 422
    broken = deepcopy(doc)
    broken["pipeline"]["nodes"][1]["parameter_credentials"][0]["path"] = ["access", -1]
    assert (await client.post("/api/v1/pipelines/import/preview", json={"document": broken})).status_code == 422


async def test_handwritten_workflow_cannot_embed_an_installation_credential_id(app_client):
    app, client = app_client
    doc, bindings, _, _, _ = await fixture(app, client)
    key = next(r["key"] for r in doc["credentials"] if r["kind"] == "module")
    doc["pipeline"]["nodes"][1]["parameters"]["access"] = [bindings[key]["id"]]
    doc["pipeline"]["nodes"][1]["parameter_credentials"] = []
    doc["credentials"] = [r for r in doc["credentials"] if r["key"] != key]
    del bindings[key]
    result = await client.post("/api/v1/pipelines/import/preview", json={"document": doc, "bindings": bindings})
    assert result.status_code == 200 and not result.json()["valid"]
    assert result.json()["errors"][0]["code"] == "credential_binding_required"
