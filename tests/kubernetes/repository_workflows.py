"""GitHub code -> downloaded ZIPs/workflows -> real Pods -> export -> fresh installation."""
import argparse
import asyncio
from functools import partial
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import threading
from uuid import uuid4
import wave

import httpx
from PIL import Image, ImageDraw, ImageFont

from support import kube_connection, wait_api
from testflow.core.config import Settings
from testflow.features.auth import credential_value
from testflow.infrastructure.database import Database

ROOT = Path(__file__).resolve().parents[2]
EXAMPLE = ROOT / "examples/repository-helpdesk"
TERMINAL = {"succeeded", "failed", "canceled", "interrupted"}


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


class Workspace:
    def __init__(self, namespace):
        if not namespace.startswith("testflow-e2e-"):
            raise ValueError("Only disposable test installations are allowed")
        self.namespace = namespace
        self.access = json.loads((ROOT / ".data/kubernetes" / namespace / "access.json").read_text())
        self.output = ROOT / ".data/acceptance" / namespace
        self.output.mkdir(parents=True, exist_ok=True)
        self.http = httpx.AsyncClient(base_url=self.access["url"] + "/api/v1", timeout=60, trust_env=False)
        self.cli, self.env = kube_connection(self.access, namespace)

    async def login(self):
        await wait_api(self.http)
        await self.call("POST", "/auth/login", {"username": "admin", "password": self.access["password"]})

    async def call(self, method, path, body=None, key=None, **kwargs):
        response = await self.http.request(method, path, json=body, headers={"Idempotency-Key": key or str(uuid4())}, **kwargs)
        if response.status_code >= 400:
            raise AssertionError(f"{method} {path}: {response.status_code} {response.text[:1200]}")
        return response.json()

    async def operation(self, identifier):
        async with asyncio.timeout(180):
            while True:
                value = await self.call("GET", "/operations/" + identifier)
                if value["state"] not in {"queued", "running"}:
                    assert value["state"] == "succeeded", value.get("error")
                    return value
                await asyncio.sleep(.3)

    async def execution(self, identifier):
        async with asyncio.timeout(240):
            while True:
                value = await self.call("GET", "/executions/" + identifier)
                if value["state"] in TERMINAL and value["cleanup"] not in {"pending", "stopping"}:
                    return value
                await asyncio.sleep(.3)

    def kube(self, *command):
        return subprocess.run(self.cli + list(command), env=self.env, check=True, capture_output=True, text=True).stdout

    def save(self, name, value):
        (self.output / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")

    async def repository(self, source):
        repo = await self.call("POST", "/repositories", {"name": "GitHub TestFlow pinned source", "url": source["url"], "branch": source["commit"]})
        await self.operation((await self.call("POST", "/repositories/" + repo["id"] + "/sync"))["id"])
        repo = await self.call("GET", "/repositories/" + repo["id"])
        assert repo["data"]["commit"] == source["commit"]
        return repo

    async def module(self, directory, item):
        content = (directory / item["file"]).read_bytes()
        assert hashlib.sha256(content).hexdigest() == item["package_digest"]
        module = await self.call("POST", "/modules/import", files={"file": (Path(item["file"]).name, content, "application/zip")})
        if module.get("operation_id"):
            await self.operation(module["operation_id"])
        return module


async def run(args):
    workspace = Workspace(args.namespace)
    copy = Workspace(args.copy_namespace)
    evidence = {"namespace": args.namespace, "copy_namespace": args.copy_namespace, "checks": [], "runs": [], "passed": False}
    server = None
    try:
        await workspace.login()
        await copy.login()
        loader = importlib.util.spec_from_file_location("example_fetch", EXAMPLE / "fetch.py")
        fetch = importlib.util.module_from_spec(loader)
        loader.loader.exec_module(fetch)
        downloads = workspace.output / "downloaded-example"
        if args.artifact_ref:
            index, origin = await asyncio.to_thread(fetch.download, downloads, ref=args.artifact_ref)
        else:
            server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(EXAMPLE)))
            threading.Thread(target=server.serve_forever, daemon=True).start()
            index, origin = await asyncio.to_thread(fetch.download, downloads, base_url=f"http://127.0.0.1:{server.server_port}/")
        evidence["artifacts"] = origin
        evidence["source"] = index["source"]
        evidence["checks"].append("five_zip_and_four_workflow_http_downloads_with_sha256")
        async with httpx.AsyncClient(timeout=45) as public:
            url = "https://raw.githubusercontent.com/Minecodex/TestFlow/" + index["source"]["commit"] + "/" + index["source"]["processor"]
            response = await public.get(url)
            response.raise_for_status()
            expected_digest = hashlib.sha256(response.content).hexdigest()
        evidence["expected_business_sha256"] = expected_digest
        documents = {name: json.loads((downloads / "workflows" / (name + ".workflow.json")).read_text()) for name in ["retrieval", "text", "voice", "image"]}
        before = await workspace.call("POST", "/pipelines/import/preview", {"document": documents["text"]})
        assert not before["valid"] and any(r["kind"] == "module" and r["state"] == "missing" for r in before["requirements"])
        assert (await workspace.call("GET", "/pipelines"))["total"] == 0
        evidence["checks"].append("fresh_preview_reports_missing_dependencies_without_creating_resources")
        repo = await workspace.repository(index["source"])
        evidence["repository"] = {"id": repo["id"], "commit": repo["data"]["commit"], "url": repo["data"]["url"]}
        evidence["checks"].append("actual_public_github_fetch_and_fixed_commit_checkout")
        modules = {item["id"]: await workspace.module(downloads, item) for item in index["modules"]}
        settings = Settings()
        database = Database(settings)
        try:
            async with database.sessions() as db:
                private = await credential_value(db, settings, (ROOT / ".data/kimi-credential-reference").read_text().strip())
        finally:
            await database.close()
        assert private, "An existing encrypted Kimi credential reference is required"
        credential = await workspace.call("POST", "/credentials", {"name": "Kimi Code", "kind": "module", "value": private})
        evaluation_credential = await workspace.call("POST", "/credentials", {"name": "Kimi evaluation", "kind": "evaluation", "value": private})
        private = None
        pipelines = {}
        for name, document in documents.items():
            body = {"document": document, "bindings": {} if name == "retrieval" else {"kimi": {"id": credential["id"]}}}
            preview = await workspace.call("POST", "/pipelines/import/preview", body)
            assert preview["valid"], preview["errors"]
            key = str(uuid4())
            imported = await workspace.call("POST", "/pipelines/import", body, key=key)
            repeated = await workspace.call("POST", "/pipelines/import", body, key=key)
            assert imported["id"] == repeated["id"]
            pipelines[name] = imported
            workspace.save(name + ".imported.json", imported)
        evidence["checks"].append("four_downloaded_workflows_imported_and_duplicate_submission_returns_same_pipeline")
        validations = {}
        for pipeline in pipelines.values():
            for node in pipeline["data"]["nodes"]:
                if node["kind"] == "module" and node["module_id"] not in validations:
                    result = await workspace.operation((await workspace.call("POST", "/modules/" + node["module_id"] + "/validate?version=" + str(node["module_version"]), node["runtime"]))["id"])
                    assert result["result"]["contract_verified"]
                    validations[node["module_id"]] = result["result"]
        evidence["validations"] = validations
        evidence["checks"].append("five_real_pods_validate_with_github_repository_mount")
        tts = next(m["image"] for m in index["modules"] if m["id"] == "repo-tts")
        generator = "import subprocess,tempfile; from pathlib import Path;\nwith tempfile.TemporaryDirectory() as d:\n a=Path(d)/'raw.wav'; b=Path(d)/'input.wav'; subprocess.run(['espeak-ng','-v','en-us','-s','135','-w',str(a),'what is the refund policy'],check=True); subprocess.run(['ffmpeg','-v','error','-i',str(a),'-ar','16000','-ac','1','-c:a','pcm_s16le',str(b)],check=True); import sys; sys.stdout.buffer.write(b.read_bytes())"
        wav = (await asyncio.to_thread(subprocess.run, ["docker", "run", "--rm", "--entrypoint", "python", tts, "-c", generator], check=True, capture_output=True)).stdout
        picture = Image.new("RGB", (1000, 160), "white")
        fonts = [Path("/System/Library/Fonts/Supplemental/Arial.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")]
        font = ImageFont.truetype(str(next(p for p in fonts if p.exists())), 42)
        ImageDraw.Draw(picture).text((25, 45), "What is the refund policy?", font=font, fill="black")
        png = io.BytesIO(); picture.save(png, format="PNG")
        (workspace.output / "question.wav").write_bytes(wav)
        (workspace.output / "question.png").write_bytes(png.getvalue())
        uploaded = await workspace.call("POST", "/media/upload", files=[("files", ("question.wav", wav, "audio/wav")), ("files", ("question.png", png.getvalue(), "image/png"))])
        assets = {i["resource"]["data"]["type"]: i["resource"] for i in uploaded["items"]}
        assert len(assets) == 2
        profile = await workspace.call("POST", "/evaluation-profiles", {"name": "Imported workflow rules", "dimensions": [
            {"id": "complete", "name": "Complete", "method": "completion", "actual": {"source": "execution", "field": "state"}},
            {"id": "structure", "name": "Structure", "method": "structure", "actual": {"source": "output", "field": ""}}]})
        datasets = {}
        for name, pipeline in pipelines.items():
            if name in {"voice", "image"}:
                asset = assets["Audio" if name == "voice" else "Image"]
                binding = {"audio" if name == "voice" else "image": {"asset_id": asset["id"], "asset_version": asset["selected_version"]}}
            else:
                binding = {"query": {"value": "What is the refund policy?"}}
            datasets[name] = await workspace.call("POST", "/datasets", {"name": "GitHub example case · " + name,
                "input_schema": pipeline["data"]["input_schema"], "output_schema": pipeline["data"]["output_schema"],
                "cases": [{"id": str(uuid4()), "name": "Repository code / " + name, "inputs": binding}]})
        task = await workspace.call("POST", "/tasks", {"name": "GitHub repository / ZIP / workflow closure",
            "pairs": [{"dataset_id": datasets[n]["id"], "dataset_version": 1, "pipeline_id": p["id"], "pipeline_version": 1} for n, p in pipelines.items()],
            "profile_id": profile["id"], "profile_version": 1, "concurrency": 1})
        await workspace.operation(task["operation_id"])
        reports = await workspace.call("GET", "/tasks/" + task["id"] + "/reports")
        assert reports["current"]["passed"] == 4, reports["current"]
        workspace.save("repository-report.json", reports)
        for row in reports["current"]["rows"]:
            execution = await workspace.execution(row["execution_id"])
            assert execution["state"] == "succeeded" and execution["cleanup"] == "stopped", execution.get("error")
            name = next(n for n, p in pipelines.items() if p["id"] == execution["snapshot"]["pipeline"]["id"])
            proof = [e["data"] for e in execution["events"] if e["kind"] == "trace.internal" and e["data"].get("name") == "repository_code_import"]
            expected_nodes = [n for n in execution["snapshot"]["pipeline"]["graph"]["nodes"] if n["kind"] == "module"]
            assert len(proof) == len(expected_nodes)
            for trace in proof:
                assert trace["sha256"] == expected_digest and trace["mount_readonly"] and trace["function_source"] == "/workspace/repository/" + index["source"]["processor"]
            for node in expected_nodes:
                assert node["runtime"]["mode"] == "pod" and node["runtime"]["code_mount"]["commit"] == index["source"]["commit"]
            if name == "retrieval":
                assert execution["output"]["context"]["documents"][0]["id"] == "returns"
            else:
                assert "14" in execution["output"]["answer"] and "returns" in execution["output"]["evidence"]["cited_ids"]
                assert execution["nodes"]["kimi"]["output"]["answer"]["eos"]
                media = execution["output"]["audio"]
                response = await workspace.http.get("/media/" + media["asset_id"] + "?version=" + str(media["asset_version"]))
                response.raise_for_status()
                with wave.open(io.BytesIO(response.content)) as audio:
                    assert (audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) == (16000, 1, 2) and audio.getnframes() > 0
                (workspace.output / (name + "-reply.wav")).write_bytes(response.content)
            workspace.save(name + "-execution.json", execution)
            evidence["runs"].append({"modality": name, "execution_id": execution["id"], "state": execution["state"], "repository_code_proofs": proof})
            print("Actual repository-code workflow passed:", name, flush=True)
        evidence["checks"].extend(["actual_mounted_python_function_identity_sha256_and_readonly_for_every_module",
                                  "offline_retrieval_and_text_voice_image_kimi_stream_tts_rule_reports"])
        exported = await workspace.call("GET", "/pipelines/" + pipelines["retrieval"]["id"] + "/export?version=1")
        workspace.save("exported-retrieval.workflow.json", exported)
        assert repo["id"] not in json.dumps(exported) and modules["repo-bm25"]["id"] not in json.dumps(exported)
        missing = await copy.call("POST", "/pipelines/import/preview", {"document": exported})
        assert not missing["valid"]
        second_repo = await copy.repository(index["source"])
        item = next(m for m in index["modules"] if m["id"] == "repo-bm25")
        second_module = await copy.module(downloads, item)
        assert second_repo["id"] != repo["id"] and second_module["id"] != modules["repo-bm25"]["id"]
        imported = await copy.call("POST", "/pipelines/import", {"document": exported})
        node = next(n for n in imported["data"]["nodes"] if n["kind"] == "module")
        assert node["module_id"] == second_module["id"] and node["runtime"]["code_mount"]["repository_id"] == second_repo["id"]
        await copy.operation((await copy.call("POST", "/modules/" + second_module["id"] + "/validate", node["runtime"]))["id"])
        second_profile = await copy.call("POST", "/evaluation-profiles", profile["data"])
        execution = await copy.call("POST", "/executions/quick", {"pipeline_id": imported["id"], "pipeline_version": 1,
            "profile_id": second_profile["id"], "profile_version": 1, "inputs": {"query": {"value": "What is the refund policy?"}}})
        actual = await copy.execution(execution["id"])
        assert actual["state"] == "succeeded" and actual["output"]["context"]["documents"][0]["id"] == "returns"
        copy.save("copied-workflow-execution.json", actual)
        evidence["copy"] = {"pipeline_id": imported["id"], "execution_id": execution["id"], "repository_id": second_repo["id"], "module_id": second_module["id"]}
        evidence["checks"].append("export_import_in_second_kubernetes_installation_remaps_ids_and_executes_same_commit")
        evaluation = await workspace.call("POST", "/evaluation-profiles", {"name": "GitHub source Kimi judge", "endpoint": "https://api.kimi.com/coding/v1", "model": "k3",
            "credential_id": evaluation_credential["id"], "response_format": "json_schema", "modalities": ["Text", "JSON"], "dimensions": [
            {"id": "grounded", "name": "Repository grounded answer", "method": "ai", "threshold": .5, "actual": {"source": "output", "field": "answer"},
             "evidence": [{"source": "output", "field": "evidence"}], "prompt": "Score 1 when the answer says returns are within 14 days and cites the returns document. Cite actual and evidence:0 when supported; otherwise score 0."}]})
        first = next(r["execution_id"] for r in evidence["runs"] if r["modality"] == "text")
        score = await workspace.call("POST", "/executions/" + first + "/reevaluate?profile_id=" + evaluation["id"] + "&profile_version=1")
        await workspace.operation(score["operation_id"])
        scored = next(e for e in (await workspace.call("GET", "/executions/" + first))["evaluations"] if e["id"] == score["id"])
        assert scored["state"] == "completed" and scored["result"]["verdict"] == "pass", scored.get("error")
        evidence["checks"].append("actual_kimi_structured_evaluation_of_repository_code_scenario")
        evidence["evaluation"] = scored["result"]
        before = await workspace.call("GET", "/tasks/" + task["id"] + "/reports")
        old = before["items"][0]
        rerun = await workspace.call("POST", "/executions/" + first + "/rerun")
        retry = await workspace.execution(rerun["id"])
        original = await workspace.call("GET", "/executions/" + first)
        assert retry["state"] == "succeeded" and retry["snapshot"]["pipeline"] == original["snapshot"]["pipeline"]
        original_instances = {n["runtime_id"] for n in original["nodes"].values() if n.get("runtime_id")}
        retry_instances = {n["runtime_id"] for n in retry["nodes"].values() if n.get("runtime_id")}
        assert original_instances and retry_instances and original_instances.isdisjoint(retry_instances)
        workspace.save("rerun-execution.json", retry)
        evidence["rerun"] = {"execution_id": retry["id"], "same_pipeline_snapshot": True, "new_runtime_instances": True}
        after = await workspace.call("GET", "/tasks/" + task["id"] + "/reports")
        assert after["current"]["plan_count"] == 4 and any(r["id"] == old["id"] and r["snapshot"] == old["snapshot"] for r in after["items"])
        evidence["checks"].append("rerun_uses_new_pod_and_preserves_pinned_code_and_old_report")
        for installation in [workspace, copy]:
            assert not json.loads(installation.kube("get", "pods", "-l", "testflow-runtime", "-o", "json"))["items"]
        evidence["checks"].append("both_installations_reclaim_all_module_pods")
        evidence["resources"] = {"task": task["id"], "pipelines": {n: p["id"] for n, p in pipelines.items()},
                                 "modules": {n: m["id"] for n, m in modules.items()}, "module_credential": credential["id"]}
        evidence["passed"] = True
    except Exception as error:
        evidence["error"] = {"type": type(error).__name__, "message": str(error)[:1500]}
        raise
    finally:
        workspace.save("repository-workflows.json", evidence)
        await workspace.http.aclose()
        await copy.http.aclose()
        if server:
            server.shutdown(); server.server_close()
    print(json.dumps({"checks": len(evidence["checks"]), "passed": evidence["passed"], "artifact_origin": evidence["artifacts"]["kind"]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--namespace", required=True)
    parser.add_argument("--copy-namespace", required=True)
    parser.add_argument("--artifact-ref", help="Published GitHub ref; omit to test unpublished artifacts over local HTTP")
    asyncio.run(run(parser.parse_args()))
