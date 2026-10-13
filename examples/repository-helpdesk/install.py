"""Install the public example through the same APIs as the UI; safe to repeat."""
import argparse
import asyncio
import hashlib
import json
from pathlib import Path
from uuid import uuid4

import httpx

from testflow.core.config import Settings
from testflow.features.auth import credential_value
from testflow.infrastructure.database import Database
from testflow.infrastructure.revisions import digest

ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = Path(__file__).resolve().parent


def same_dataset(value):
    return {**value, "cases": [{k: v for k, v in case.items() if k != "id"} for case in value.get("cases", [])]}


class Installer:
    def __init__(self, namespace, directory=DIRECTORY, *, module_credential_id=None, credential_file=None):
        if not namespace.startswith("testflow-"):
            raise ValueError("Choose an explicit TestFlow namespace")
        self.namespace, self.directory = namespace, directory
        self.access = json.loads((ROOT / ".data/kubernetes" / namespace / "access.json").read_text())
        from urllib.parse import urlsplit
        if self.access["namespace"] != namespace or urlsplit(self.access["url"]).hostname not in {"127.0.0.1", "localhost"}:
            raise ValueError("The private access file must match the selected local installation")
        self.http = httpx.AsyncClient(base_url=self.access["url"] + "/api/v1", timeout=90, trust_env=False)
        self.index = json.loads((directory / "downloads/index.json").read_text())
        if self.index["format"] != "testflow.example.v1":
            raise ValueError("Unsupported example index")
        self.module_credential_id, self.credential_file = module_credential_id, credential_file
        self.evidence = {"namespace": namespace, "url": self.access["url"], "source": self.index["source"],
            "assets": {}, "datasets": {}, "pipelines": {}, "modules": {}, "validations": {}, "checks": [], "installed": False}

    async def call(self, method, path, body=None, key=None, **kwargs):
        response = await self.http.request(method, path, json=body, headers={"Idempotency-Key": key or str(uuid4())}, **kwargs)
        if response.status_code >= 400:
            # Responses expose public field errors only. Request bodies and access secrets stay private.
            raise RuntimeError(f"{method} {path}: {response.status_code} {response.text[:1000]}")
        return response.json()

    async def resources(self, kind):
        values, page = [], 1
        while True:
            result = await self.call("GET", f"/{kind}?page={page}&page_size=100")
            values.extend(result["items"])
            if len(values) >= result["total"] or not result["items"]:
                return values
            page += 1

    async def operation(self, identifier):
        async with asyncio.timeout(300):
            while True:
                value = await self.call("GET", "/operations/" + identifier)
                if value["state"] not in {"queued", "running"}:
                    if value["state"] != "succeeded":
                        raise RuntimeError(f"Operation {identifier}: {value.get('error')}")
                    return value
                await asyncio.sleep(.4)

    def artifact(self, item, digest_key="sha256"):
        path = (self.directory / item["file"]).resolve()
        if not path.is_relative_to(self.directory.resolve()):
            raise ValueError("Unsafe example artifact path")
        value = path.read_bytes()
        if hashlib.sha256(value).hexdigest() != item[digest_key]:
            raise ValueError("Example checksum mismatch: " + item["file"])
        return value

    async def module_credential(self):
        if self.module_credential_id:
            credentials = (await self.call("GET", "/credentials"))["items"]
            if not any(c["id"] == self.module_credential_id and c["kind"] == "module" for c in credentials):
                raise ValueError("Select a module credential from this installation")
            return self.module_credential_id
        credentials = (await self.call("GET", "/credentials"))["items"]
        existing = next((c for c in credentials if c["kind"] == "module" and c["name"] == "Kimi Code example"), None)
        if existing:
            return existing["id"]
        if self.credential_file:
            private = self.credential_file.read_text().strip()
        else:
            reference = ROOT / ".data/kimi-credential-reference"
            if not reference.exists():
                raise ValueError("Provide --module-credential-id or a private --credential-file for the Kimi workflows")
            settings = Settings()
            database = Database(settings)
            try:
                async with database.sessions() as db:
                    private = await credential_value(db, settings, reference.read_text().strip())
            finally:
                await database.close()
        if not private:
            raise ValueError("The configured example credential is unavailable")
        return (await self.call("POST", "/credentials", {"name": "Kimi Code example", "kind": "module", "value": private}))["id"]

    async def configure_module(self, imported, repository):
        # An idempotent import may return its original response after launch defaults were edited.
        module = await self.call("GET", "/modules/" + imported["id"])
        if module["data"]["package_digest"] != imported["data"]["package_digest"]:
            raise ValueError("The example package is historical; use the current module package before editing launch defaults")
        saved = module["data"].get("runtime") or module["data"]["manifest"]["runtime"]
        runtime = {**saved, "code_mount": {"repository_id": repository["id"],
            "repository_version": repository["selected_version"], "commit": repository["data"]["commit"],
            "mount_path": "/workspace/repository"}}
        if runtime != saved:
            module = await self.call("PUT", "/modules/" + module["id"] + "/runtime", {
                "expected_version": module["version"], "runtime": runtime})
        return module

    async def install(self, run=False):
        try:
            await self.call("POST", "/auth/login", {"username": self.access["username"], "password": self.access["password"]})
            source = self.index["source"]
            repositories = await self.resources("repositories")
            repo = next((r for r in repositories if r["data"]["url"] == source["url"] and r["data"].get("commit") == source["commit"] and r["data"].get("code_path")), None)
            if not repo:
                repo = next((r for r in repositories if r["name"] == "GitHub TestFlow pinned source" and r["data"]["url"] == source["url"] and r["data"]["branch"] == source["commit"]), None)
                if not repo:
                    repo = await self.call("POST", "/repositories", {"name": "GitHub TestFlow pinned source", "url": source["url"], "branch": source["commit"], "description": "Open-source example business functions; pinned read-only code mount"})
                await self.operation((await self.call("POST", "/repositories/" + repo["id"] + "/sync"))["id"])
                repo = await self.call("GET", "/repositories/" + repo["id"])
            if repo["data"]["commit"] != source["commit"]:
                raise ValueError("Repository did not resolve to the pinned example commit")
            self.evidence["repository"] = {"id": repo["id"], "version": repo["selected_version"], "commit": source["commit"]}
            print("Pinned GitHub repository synchronized", flush=True)
            modules = {}
            for item in self.index["modules"]:
                content = self.artifact(item, "package_digest")
                module = await self.call("POST", "/modules/import", files={"file": (Path(item["file"]).name, content, "application/zip")}, key="example-module:" + item["package_digest"])
                if module.get("operation_id"):
                    await self.operation(module["operation_id"])
                module = await self.configure_module(module, repo)
                validation = await self.call("POST", f"/modules/{module['id']}/validate?version={module['selected_version']}")
                self.evidence["validations"][module["id"]] = (await self.operation(validation["id"]))["result"]
                modules[item["key"]] = module
                self.evidence["modules"][item["key"]] = {"id": module["id"], "version": module["selected_version"]}
            credential = await self.module_credential()
            pipelines, existing = {}, await self.resources("pipelines")
            for item in self.index["workflows"]:
                document = json.loads(self.artifact(item))
                bindings = {c["key"]: {"id": credential} for c in document["credentials"]}
                bindings.update({m["key"]: {"id": modules[m["id"]]["id"], "version": modules[m["id"]]["selected_version"]}
                                 for m in document["modules"]})
                bindings.update({r["key"]: {"id": repo["id"], "version": repo["selected_version"]}
                                 for r in document["repositories"]})
                body = {"document": document, "bindings": bindings}
                preview = await self.call("POST", "/pipelines/import/preview", body)
                if not preview["valid"]:
                    raise ValueError("Workflow dependency validation failed: " + json.dumps(preview["requirements"]))
                pipeline = next((p for p in existing if p["data"] == preview["pipeline"]), None)
                if not pipeline:
                    pipeline = await self.call("POST", "/pipelines/import", body, key="example-workflow:" + digest(body))
                name = Path(item["file"]).name.split(".")[0]
                pipelines[name] = pipeline
                self.evidence["pipelines"][name] = {"id": pipeline["id"], "version": pipeline["selected_version"]}
            print("Five module Pods validated; four workflows imported", flush=True)
            for item in self.index["assets"]:
                content = self.artifact(item)
                result = await self.call("POST", "/assets/import", files={"file": (Path(item["file"]).name, content, "application/zip")}, key="example-assets:" + item["sha256"])
                self.evidence["assets"].update({a["key"]: a["resource"] for a in result["items"]})
            datasets, existing = {}, await self.resources("datasets")
            for item in self.index["datasets"]:
                body = {"document": json.loads(self.artifact(item))}
                preview = await self.call("POST", "/datasets/import/preview", body)
                if not preview["valid"]:
                    raise ValueError("Dataset asset or schema binding failed")
                dataset = next((d for d in existing if same_dataset(d["data"]) == same_dataset(preview["dataset"])), None)
                if not dataset:
                    dataset = await self.call("POST", "/datasets/import", body, key="example-dataset:" + digest(body))
                name = Path(item["file"]).name.split(".")[0]
                datasets[name] = dataset
                self.evidence["datasets"][name] = {"id": dataset["id"], "version": dataset["selected_version"]}
            profile_name = "GitHub example · completion and structure"
            profile = next((p for p in await self.resources("evaluation-profiles") if p["name"] == profile_name), None)
            if not profile:
                profile = await self.call("POST", "/evaluation-profiles", {"name": profile_name, "dimensions": [
                    {"id": "complete", "name": "正常完成", "method": "completion", "actual": {"source": "execution", "field": "state"}},
                    {"id": "structure", "name": "输出结构", "method": "structure", "actual": {"source": "output", "field": ""}}]})
            self.evidence["profile"] = {"id": profile["id"], "version": profile["selected_version"]}
            self.evidence["checks"].extend(["real_github_pinned_repository", "saved_module_launch_defaults", "five_imported_modules_and_real_pod_validation", "four_portable_workflows", "three_packaged_assets", "four_fixed_asset_datasets"])
            self.evidence["installed"] = True
            print("Three assets, four datasets and evaluation rules ready", flush=True)
            if run:
                body = {"name": "GitHub example · 完整闭环", "concurrency": 1, "profile_id": profile["id"], "profile_version": profile["selected_version"],
                    "pairs": [{"dataset_id": datasets[n]["id"], "dataset_version": datasets[n]["selected_version"], "pipeline_id": p["id"], "pipeline_version": p["selected_version"]} for n, p in pipelines.items()]}
                preview = await self.call("POST", "/tasks/preview", body)
                if preview["plan_count"] != 4:
                    raise ValueError("Example task preflight failed")
                task = await self.call("POST", "/tasks", body, key="example-task:" + digest(body))
                await self.operation(task["operation_id"])
                report = await self.call("GET", "/tasks/" + task["id"] + "/reports")
                self.evidence["task"] = {"id": task["id"], "report": report["current"]}
                if report["current"]["passed"] != 4:
                    raise RuntimeError("Example task did not pass all four cases")
                self.evidence["checks"].append("four_real_container_workflows_and_rule_reports")
                print("All four example workflows completed and passed rules", flush=True)
            return self.evidence
        except Exception as error:
            self.evidence["error"] = {"type": type(error).__name__, "message": str(error)[:1500]}
            raise
        finally:
            output = ROOT / ".data/example-installations" / self.namespace
            output.mkdir(parents=True, exist_ok=True)
            (output / "installed.json").write_text(json.dumps(self.evidence, ensure_ascii=False, indent=2) + "\n")
            await self.http.aclose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--namespace", required=True)
    parser.add_argument("--directory", type=Path, default=DIRECTORY)
    parser.add_argument("--module-credential-id")
    parser.add_argument("--credential-file", type=Path, help="Private file; never pass the key as a command argument")
    parser.add_argument("--run", action="store_true", help="Submit the real four-case example batch; uses the configured remote Kimi service")
    args = parser.parse_args()
    asyncio.run(Installer(args.namespace, args.directory, module_credential_id=args.module_credential_id, credential_file=args.credential_file).install(args.run))
