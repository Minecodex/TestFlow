"""Create deterministic downloadable ZIPs and workflows; optionally build their images."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

from testflow.features.pipelines.transfer_contracts import WorkflowDocument
from build_data import build_data

ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = Path(__file__).resolve().parent


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def build(images=False):
    source = json.loads((DIRECTORY / "source.json").read_text())
    identity = hashlib.sha256()
    for path in [DIRECTORY / "Dockerfile", DIRECTORY / "adapter.py", DIRECTORY / "build.py",
                 ROOT / "examples/scenarios/tiny-helpdesk/service.py", ROOT / "examples/scenarios/tiny-helpdesk/prepare_models.py",
                 ROOT / "examples/modules/common/ui.js"]:
        identity.update(path.read_bytes())
    version = "1.0.0-" + identity.hexdigest()[:12]
    field = lambda name, kind, stream=False: {"name": name, "type": kind, "stream": stream,
        "format": {"Text": "UTF-8", "JSON": "application/json", "Audio": "WAV · 16kHz · Mono", "Image": "Image/*"}[kind]}
    query, audio, image = field("query", "Text"), field("audio", "Audio"), field("image", "Image")
    context, evidence, answer = field("context", "JSON"), field("evidence", "JSON"), field("answer", "Text")
    specs = [
        ("repo-bm25", "Repository BM25", [query], [query, context], {"top_k": {"type": "integer", "minimum": 1, "maximum": 3}}, {"top_k": 2}),
        ("repo-asr", "Repository tiny ASR", [audio], [query], {}, {}),
        ("repo-ocr", "Repository tiny OCR", [image], [query], {}, {}),
        ("repo-kimi", "Repository Kimi answer", [query, context], [field("answer", "Text", True), evidence],
         {"credential_id": {"type": "string", "minLength": 1, "x-testflow-credential": True}}, {"credential_id": "configure-module-credential"}),
        ("repo-tts", "Repository tiny TTS", [answer], [answer, audio], {"speed": {"type": "integer", "minimum": 100, "maximum": 220}}, {"speed": 150}),
    ]
    modules, contracts = {}, {}
    for identifier, name, inputs, outputs, properties, defaults in specs:
        image_name = f"testflow/{identifier}:v{version}"
        manifest = {"protocol": "testflow.module.v1", "id": identifier, "name": name, "version": version,
                    "description": "Thin adapter importing business code from the pinned TestFlow Git mount",
                    "exposes_trace": True, "defaults": defaults,
                    "runtime": {"mode": "pod", "image": image_name, "port": 8080, "reuse_scope": "batch_node",
                                "requires_sequential": False, "cpu": "500m", "memory": "384Mi"}}
        package = DIRECTORY / "packages" / identifier
        for filename, value in [("manifest.json", manifest), ("schemas/inputs.json", {"fields": inputs}),
                                ("schemas/outputs.json", {"fields": outputs}), ("schemas/parameters.json", {
                                    "$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object", "properties": properties,
                                    "required": list(properties), "additionalProperties": False})]:
            write(package / filename, value)
        (package / "ui").mkdir(exist_ok=True)
        (package / "ui/config-panel.js").write_bytes((ROOT / "examples/modules/common/ui.js").read_bytes())
        (package / "README.md").write_text(f"# {name}\n\nMount the synced TestFlow repository at `/workspace/repository`; see `examples/repository-helpdesk/README.md`.\nThe image contains the protocol host and adapter, not the imported business implementation.\n")
        archive = DIRECTORY / "downloads/modules" / f"{identifier}.zip"
        subprocess.run(["uv", "run", "--project", "server", "python", "scripts/module-package.py", "package", str(package), "--output", str(archive)], cwd=ROOT, check=True)
        if images:
            subprocess.run(["docker", "build", "-f", str(DIRECTORY / "Dockerfile"), "--build-arg", "MODULE=" + identifier,
                            "-t", image_name, str(ROOT)], check=True)
        modules[identifier] = {"key": identifier, "id": identifier, "version": version, "package_digest": hashlib.sha256(archive.read_bytes()).hexdigest()}
        contracts[identifier] = {"inputs": {"fields": inputs}, "outputs": {"fields": outputs}, "defaults": defaults, "runtime": manifest["runtime"]}
    repository = {"key": "testflow", "name": "TestFlow open-source examples", "url": source["url"], "commit": source["commit"]}

    def node(nid, identifier, x):
        contract = contracts[identifier]
        return {"id": nid, "name": identifier, "kind": "module", "module_key": identifier, "x": x, "y": 200,
                "parameters": {"credential_id": None} if identifier == "repo-kimi" else contract["defaults"],
                "parameter_credentials": [{"path": ["credential_id"], "credential_key": "kimi"}] if identifier == "repo-kimi" else [],
                "runtime": {**contract["runtime"], "code_mount": {"repository_key": "testflow", "commit": source["commit"], "mount_path": "/workspace/repository"}},
                "timeout": 90, "input_schema": contract["inputs"], "output_schema": contract["outputs"]}

    for modality in ["retrieval", "text", "voice", "image"]:
        recognition = {"voice": "repo-asr", "image": "repo-ocr"}.get(modality)
        inp = contracts[recognition or "repo-bm25"]["inputs"]
        out = contracts["repo-bm25"]["outputs"] if modality == "retrieval" else {"fields": [answer, audio, evidence]}
        nodes = [{"id": "start", "name": "Start", "kind": "start", "x": 0, "y": 200, "output_schema": inp}]
        edges = []
        if recognition:
            nodes.append(node("recognition", recognition, 160))
            edges.extend([("start", "recognition"), ("recognition", "retrieval")])
        else:
            edges.append(("start", "retrieval"))
        nodes.append(node("retrieval", "repo-bm25", 350))
        if modality == "retrieval":
            edges.append(("retrieval", "end"))
        else:
            full = {"fields": [answer, evidence]}
            nodes.extend([node("kimi", "repo-kimi", 550),
                {"id": "full", "kind": "conversion", "name": "Collect stream", "direction": "to_full", "x": 750, "y": 200,
                 "input_schema": contracts["repo-kimi"]["outputs"], "output_schema": full},
                {"id": "answer", "kind": "assembly", "name": "Answer field", "x": 950, "y": 200,
                 "output_schema": {"fields": [answer]}, "mappings": [{"target": "answer", "source": "full", "field": "answer"}]},
                node("tts", "repo-tts", 1150),
                {"id": "result", "kind": "assembly", "name": "Answer, audio and evidence", "x": 1350, "y": 200,
                 "output_schema": out, "mappings": [{"target": "answer", "source": "tts", "field": "answer"},
                 {"target": "audio", "source": "tts", "field": "audio"}, {"target": "evidence", "source": "full", "field": "evidence"}]}])
            edges.extend([("retrieval", "kimi"), ("kimi", "full"), ("full", "answer"), ("answer", "tts"),
                          ("tts", "result"), ("full", "result"), ("result", "end")])
        nodes.append({"id": "end", "kind": "end", "name": "End", "x": 1550 if modality != "retrieval" else 550, "y": 200, "input_schema": out, "output_schema": out})
        used = {n["module_key"] for n in nodes if n["kind"] == "module"}
        document = WorkflowDocument.model_validate({"format": "testflow.workflow.v1", "repositories": [repository],
            "modules": [modules[k] for k in sorted(used)], "credentials": [] if modality == "retrieval" else [{"key": "kimi", "name": "Kimi Code", "kind": "module"}],
            "pipeline": {"name": f"GitHub example · {modality}", "description": "Business functions imported from a fixed GitHub commit in real module Pods",
                "input_schema": inp, "output_schema": out, "preparation_timeout": 90, "cleanup_timeout": 10,
                "nodes": nodes, "edges": [{"source": a, "target": b} for a, b in edges]}})
        write(DIRECTORY / "workflows" / (modality + ".workflow.json"), document.model_dump(mode="json"))
    index = {"format": "testflow.example.v1", "source": source,
             "modules": [{**m, "image": contracts[k]["runtime"]["image"], "file": "downloads/modules/" + k + ".zip"} for k, m in modules.items()],
             "workflows": [{"file": f"workflows/{m}.workflow.json", "sha256": hashlib.sha256((DIRECTORY / f"workflows/{m}.workflow.json").read_bytes()).hexdigest()}
                           for m in ["retrieval", "text", "voice", "image"]]}
    write(DIRECTORY / "downloads/index.json", build_data(index))
    print(json.dumps({"modules": len(modules), "workflows": 4, "assets": 3, "datasets": 4, "version": version}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--build", action="store_true")
    args = parser.parse_args()
    build(args.build)
