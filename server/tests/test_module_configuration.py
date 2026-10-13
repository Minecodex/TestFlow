"""Module launch revisions remain separate from business parameter and workflow revisions."""
from copy import deepcopy
import io
import json
import zipfile

import pytest
from sqlalchemy import select
from testflow.infrastructure.models import Operation
from testflow.infrastructure.revisions import save_resource

TEXT = {"fields": [{"name": "text", "type": "Text", "format": "UTF-8", "stream": False}]}


async def imported(client, *, sequential=False, isolated=False):
    manifest = {"protocol": "testflow.module.v1", "id": "configured-text", "name": "Configured text", "version": "1.0.0",
                "defaults": {"prefix": "Initial"}, "runtime": {"mode": "pod", "image": "testflow/configured:v1",
                "requires_sequential": sequential, "reuse_scope": "execution_node" if isolated else "batch_node"}}
    schema = {"type": "object", "properties": {"prefix": {"type": "string"}}, "required": ["prefix"], "additionalProperties": False}
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, value in {"manifest.json": manifest, "schemas/inputs.json": TEXT, "schemas/outputs.json": TEXT,
                            "schemas/parameters.json": schema}.items():
            archive.writestr(name, json.dumps(value))
        archive.writestr("README.md", "Configured fixture")
        archive.writestr("ui/config-panel.js", "export const sdk='testflow.ui.v1'; export default function Panel(){return null;}")
    content = buffer.getvalue()
    response = await client.post("/api/v1/modules/import", files={"file": ("module.zip", content)}, headers={"Idempotency-Key": "import-config"})
    assert response.status_code == 200, response.text
    return response.json(), content


def graph(module):
    return {"name": "Configured flow", "input_schema": TEXT, "output_schema": TEXT, "nodes": [
        {"id": "start", "kind": "start", "name": "Start", "output_schema": TEXT},
        {"id": "module", "kind": "module", "name": "Process", "description": "A meaningful business step",
         "module_id": module["id"], "module_version": module["selected_version"], "parameters": {"prefix": "Business"}},
        {"id": "end", "kind": "end", "name": "End", "input_schema": TEXT}],
        "edges": [{"source": "start", "target": "module"}, {"source": "module", "target": "end"}]}


@pytest.mark.asyncio
async def test_runtime_saved_as_revision_without_changing_zip_or_old_nodes(app_client):
    app, client = app_client
    module, content = await imported(client)
    original = deepcopy(module["data"])
    runtime = {**original["runtime"], "cpu": "250m", "memory": "256Mi"}
    response = await client.put(f"/api/v1/modules/{module['id']}/runtime", json={"expected_version": 1, "runtime": runtime})
    assert response.status_code == 200, response.text
    configured = response.json()
    assert configured["version"] == 2 and configured["data"]["runtime"] == runtime
    assert configured["data"]["manifest"] == original["manifest"]
    assert configured["data"]["package_digest"] == original["package_digest"]
    assert configured["data"]["contract_digest"] == original["contract_digest"]
    assert (await client.get(f"/api/v1/modules/{module['id']}?version=1")).json()["data"] == original
    for selected, cpu in [(module, "500m"), (configured, "250m")]:
        resolved = await client.post("/api/v1/pipelines/validate", json=graph(selected))
        assert resolved.status_code == 200 and resolved.json()["valid"], resolved.text
        assert resolved.json()["graph"]["nodes"][1]["runtime"]["cpu"] == cpu
        assert resolved.json()["graph"]["nodes"][1]["parameters"] == {"prefix": "Business"}
    duplicate = await client.post("/api/v1/modules/import", files={"file": ("module.zip", content)}, headers={"Idempotency-Key": "duplicate-config"})
    assert duplicate.json()["selected_version"] == 2 and duplicate.json()["data"]["runtime"] == runtime
    stale = await client.put(f"/api/v1/modules/{module['id']}/runtime", json={"expected_version": 1, "runtime": {**runtime, "cpu": "1"}})
    assert stale.status_code == 409
    same = await client.put(f"/api/v1/modules/{module['id']}/runtime", json={"expected_version": 2, "runtime": runtime})
    assert same.json()["version"] == 2
    document = (await client.post("/api/v1/pipelines/export", json=graph(configured))).json()
    assert document["pipeline"]["nodes"][1]["description"] == "A meaningful business step"
    preview = await client.post("/api/v1/pipelines/import/preview", json={"document": document,
        "bindings": {document["modules"][0]["key"]: {"id": module["id"], "version": 2}}})
    assert preview.status_code == 200 and preview.json()["valid"], preview.text
    assert preview.json()["pipeline"]["nodes"][1]["description"] == "A meaningful business step"
    assert preview.json()["pipeline"]["nodes"][1]["runtime"]["cpu"] == "250m"


@pytest.mark.asyncio
async def test_runtime_binding_and_declared_requirements_are_validated(app_client):
    app, client = app_client
    module, _ = await imported(client, sequential=True, isolated=True)
    runtime = module["data"]["runtime"]
    url = f"/api/v1/modules/{module['id']}/runtime"
    for patch, code in [({"requires_sequential": False}, "sequential_required"), ({"reuse_scope": "batch_node"}, "isolated_instance_required")]:
        response = await client.put(url, json={"expected_version": 1, "runtime": {**runtime, **patch}})
        assert response.status_code == 422 and response.json()["code"] == code
    async with app.state.database.sessions() as db, db.begin():
        repo = await save_resource(db, "repositories", {"name": "Fixed source", "url": "https://example.test/source.git",
            "branch": "main", "commit": "a" * 40, "code_path": "repositories/fixed"})
    mount = {"repository_id": repo["id"], "repository_version": 1, "commit": "b" * 40, "mount_path": "/workspace/code"}
    response = await client.put(url, json={"expected_version": 1, "runtime": {**runtime, "code_mount": mount}})
    assert response.status_code == 422 and response.json()["code"] == "code_unavailable"
    mount["commit"] = "a" * 40
    response = await client.put(url, json={"expected_version": 1, "runtime": {**runtime, "code_mount": mount}})
    assert response.status_code == 200, response.text
    configured = response.json()
    pending = await client.post(f"/api/v1/modules/{module['id']}/validate", headers={"Idempotency-Key": "pending-validation"})
    assert pending.status_code == 409
    async with app.state.database.sessions() as db, db.begin():
        operation = (await db.scalars(select(Operation).where(Operation.kind == "module.import"))).one()
        operation.state = "succeeded"
    valid = await client.post(f"/api/v1/modules/{module['id']}/validate", headers={"Idempotency-Key": "saved-validation"})
    assert valid.status_code == 200, valid.text
    payload = valid.json()["payload"]
    assert payload["revision_id"] == configured["revision_id"]
    assert payload["runtime"] == configured["data"]["runtime"]
    assert payload["repository"]["id"] == repo["id"]


@pytest.mark.asyncio
async def test_example_installer_persists_launch_defaults_and_keeps_current_user_edits(app_client):
    from importlib.util import module_from_spec, spec_from_file_location
    from pathlib import Path
    from uuid import uuid4
    app, client = app_client
    source = Path(__file__).resolve().parents[2] / "examples/repository-helpdesk/install.py"
    spec = spec_from_file_location("example_installer_configuration_test", source)
    installer_module = module_from_spec(spec)
    spec.loader.exec_module(installer_module)
    installer = installer_module.Installer.__new__(installer_module.Installer)

    async def call(method, path, body=None):
        response = await client.request(method, "/api/v1" + path, json=body,
                                        headers={"Idempotency-Key": str(uuid4())})
        assert response.status_code == 200, response.text
        return response.json()
    installer.call = call
    module, _ = await imported(client)
    async with app.state.database.sessions() as db, db.begin():
        repository = await save_resource(db, "repositories", {"name": "Example fixed source",
            "url": "https://example.test/source.git", "branch": "a" * 40,
            "commit": "a" * 40, "code_path": "repositories/example-fixed"})
    configured = await installer.configure_module(module, repository)
    assert configured["selected_version"] == 2
    assert configured["data"]["runtime"]["code_mount"] == {"repository_id": repository["id"],
        "repository_version": repository["selected_version"], "commit": "a" * 40, "mount_path": "/workspace/repository"}
    assert configured["data"]["manifest"] == module["data"]["manifest"]
    edited = await call("PUT", "/modules/" + module["id"] + "/runtime", {"expected_version": 2,
        "runtime": {**configured["data"]["runtime"], "cpu": "275m", "memory": "256Mi"}})
    # Replaying the initial import response must not reset the user's current module revision.
    repeated = await installer.configure_module(module, repository)
    assert repeated["selected_version"] == edited["selected_version"] == 3
    assert repeated["data"]["runtime"]["cpu"] == "275m"
    assert repeated["data"]["runtime"]["memory"] == "256Mi"
    assert (await call("GET", "/modules/" + module["id"] + "?version=1"))["data"] == module["data"]
