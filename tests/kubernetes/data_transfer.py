"""Portable data packages and the full example in a disposable Kubernetes workspace."""
import argparse
import asyncio
from copy import deepcopy
from functools import partial
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import io
import json
from pathlib import Path
import shutil
import sys
import threading
import zipfile

from support import kube_connection

ROOT = Path(__file__).resolve().parents[2]
EXAMPLE = ROOT / "examples/repository-helpdesk"
sys.path.insert(0, str(EXAMPLE))
from install import Installer
from fetch import download


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


async def run(namespace):
    if not namespace.startswith("testflow-e2e-"):
        raise ValueError("Only disposable namespaces may run acceptance tests")
    output = ROOT / ".data/acceptance" / namespace
    output.mkdir(parents=True, exist_ok=True)
    evidence = {"namespace": namespace, "checks": [], "passed": False}
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(EXAMPLE)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    directory = output / "downloaded-example"
    workspace = None
    try:
        index, origin = await asyncio.to_thread(download, directory, base_url=f"http://127.0.0.1:{server.server_port}/")
        evidence["artifacts"] = origin
        evidence["checks"].append("all_zip_workflow_asset_dataset_http_downloads_verified_by_sha256")
        workspace = Installer(namespace, directory)
        await workspace.call("POST", "/auth/login", {"username": workspace.access["username"], "password": workspace.access["password"]})
        dataset_documents = {name: json.loads((directory / "datasets" / (name + ".dataset.json")).read_text()) for name in ["retrieval", "text", "voice", "image"]}
        missing = await workspace.call("POST", "/datasets/import/preview", {"document": dataset_documents["voice"]})
        assert not missing["valid"] and missing["requirements"][0]["state"] == "missing"
        assert (await workspace.call("GET", "/datasets"))["total"] == 0
        evidence["checks"].append("missing_asset_preview_is_read_only_and_blocks_import")
        pool = workspace.artifact(index["assets"][0])
        with zipfile.ZipFile(io.BytesIO(pool)) as archive:
            broken = {name: archive.read(name) for name in archive.namelist()}
        manifest = json.loads(broken["manifest.json"])
        manifest["assets"][-1]["file"]["sha256"] = "0" * 64
        broken["manifest.json"] = json.dumps(manifest).encode()
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            for path, content in broken.items(): archive.writestr(path, content)
        rejected = await workspace.http.post("/assets/import", files={"file": ("bad.zip", buffer.getvalue())}, headers={"Idempotency-Key": "bad"})
        assert rejected.status_code == 422 and (await workspace.call("GET", "/assets"))["total"] == 0
        evidence["checks"].append("tampered_package_rejected_before_any_asset_is_created")
        preview = await workspace.call("POST", "/assets/import/preview", files={"file": ("pool.zip", pool)})
        assert len(preview["items"]) == 3 and all(i["state"] == "create" for i in preview["items"])
        imported = await workspace.call("POST", "/assets/import", key="pool-original", files={"file": ("pool.zip", pool)})
        repeated = await workspace.call("POST", "/assets/import", key="pool-original", files={"file": ("pool.zip", pool)})
        assert repeated == imported and imported["created"] == 3
        assert (await workspace.call("POST", "/assets/import", files={"file": ("pool.zip", pool)}))["reused"] == 3
        evidence["checks"].append("asset_import_idempotency_and_revision_deduplication")
        query = next(i for i in imported["items"] if i["key"] == "query")["resource"]
        asset = await workspace.call("GET", "/assets/" + query["id"])
        edited = {**asset["data"], "reference": "New annotation", "tags": ["changed-after-import"]}
        await workspace.call("PUT", "/assets/" + query["id"], {"expected_version": 1, "data": edited})
        fixed = await workspace.call("POST", "/datasets/import/preview", {"document": dataset_documents["text"]})
        assert fixed["valid"] and fixed["dataset"]["cases"][0]["inputs"]["query"]["asset_version"] == 1
        for item in imported["items"]:
            await workspace.call("POST", "/assets/" + item["resource"]["id"] + "/hide")
        assert not (await workspace.call("POST", "/datasets/import/preview", {"document": dataset_documents["text"]}))["valid"]
        assert (await workspace.http.get("/media/" + query["id"] + "?version=1")).status_code == 200
        visible = await workspace.call("POST", "/assets/import", files={"file": ("pool.zip", pool)})
        assert visible["created"] == 3 and {i["resource"]["id"] for i in visible["items"]}.isdisjoint({i["resource"]["id"] for i in imported["items"]})
        evidence["checks"].append("annotations_pin_old_revisions_hidden_assets_keep_media_and_new_imports_remap_ids")
        await workspace.http.aclose()
        workspace = Installer(namespace, directory)
        installed = await workspace.install(run=True)
        evidence["installed"] = installed
        evidence["checks"].extend(installed["checks"])
        # Repeating the installer must reuse every resource and the completed task.
        again = await Installer(namespace, directory).install(run=True)
        for field in ["repository", "modules", "assets", "pipelines", "datasets", "profile"]:
            assert again[field] == installed[field], field
        assert again["task"]["id"] == installed["task"]["id"]
        evidence["checks"].append("repeat_installer_reuses_resources_and_same_completed_task")
        workspace = Installer(namespace, directory)
        await workspace.call("POST", "/auth/login", {"username": workspace.access["username"], "password": workspace.access["password"]})
        copy = output / "exported-example"
        shutil.copytree(directory, copy, dirs_exist_ok=True)
        exported_index = deepcopy(index)
        exported = await workspace.http.post("/assets/export", json={"assets": list(installed["assets"].values())})
        assert exported.status_code == 200
        pool_path = copy / index["assets"][0]["file"]
        pool_path.write_bytes(exported.content)
        exported_index["assets"][0]["sha256"] = hashlib.sha256(exported.content).hexdigest()
        with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
            raw = archive.read("manifest.json").decode()
            assert all(item["id"] not in raw for item in installed["assets"].values())
            assert '"blob"' not in raw and '"execution_id"' not in raw
        assert (await workspace.call("POST", "/assets/import", files={"file": ("export.zip", exported.content)}))["reused"] == 3
        for group, resource_type in [("datasets", "datasets"), ("workflows", "pipelines")]:
            for item in exported_index[group]:
                name = Path(item["file"]).name.split(".")[0]
                resource = installed[resource_type][name]
                document = await workspace.call("GET", f"/{resource_type}/{resource['id']}/export?version={resource['version']}")
                raw = json.dumps(document, ensure_ascii=False, indent=2) + "\n"
                assert all(a["id"] not in raw for a in installed["assets"].values())
                assert installed["repository"]["id"] not in raw
                (copy / item["file"]).write_text(raw)
                item["sha256"] = hashlib.sha256(raw.encode()).hexdigest()
        (copy / "downloads/index.json").write_text(json.dumps(exported_index, ensure_ascii=False, indent=2) + "\n")
        evidence["exported_example"] = str(copy)
        evidence["checks"].append("pool_datasets_and_workflows_export_as_portable_files_without_installation_ids")
        proofs = []
        for row in installed["task"]["report"]["rows"]:
            execution = await workspace.call("GET", "/executions/" + row["execution_id"])
            assert execution["state"] == "succeeded" and execution["cleanup"] == "stopped"
            input_asset = next(iter(execution["snapshot"]["inputs"].values()))["asset"]
            assert input_asset["selected_version"] == 1 and "repository-helpdesk" in input_asset["data"]["tags"]
            traces = [e["data"] for e in execution["events"] if e["kind"] == "trace.internal" and e["data"].get("name") == "repository_code_import"]
            assert traces and all(t["mount_readonly"] and t["function_source"].startswith("/workspace/repository/") for t in traces)
            (output / (row["execution_id"] + ".execution.json")).write_text(json.dumps(execution, ensure_ascii=False, indent=2) + "\n")
            proofs.append({"execution_id": execution["id"], "input_asset_id": input_asset["id"], "proofs": traces})
        evidence["executions"] = proofs
        evidence["checks"].append("all_four_real_pod_executions_freeze_imported_input_assets_and_mounted_business_code")
        cli, env = kube_connection(workspace.access, namespace)
        import subprocess
        pods = json.loads(subprocess.run(cli + ["get", "pods", "-l", "testflow-runtime", "-o", "json"], env=env, check=True, capture_output=True, text=True).stdout)["items"]
        assert not pods
        evidence["checks"].append("runtime_pods_reclaimed_after_example_batch")
        evidence["passed"] = True
    except Exception as error:
        evidence["error"] = {"type": type(error).__name__, "message": str(error)[:1500]}
        raise
    finally:
        (output / "data-transfer.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n")
        if workspace:
            await workspace.http.aclose()
        server.shutdown(); server.server_close()
    print(json.dumps({"passed": evidence["passed"], "checks": len(evidence["checks"]), "exported_example": evidence["exported_example"]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--namespace", required=True)
    asyncio.run(run(parser.parse_args().namespace))
