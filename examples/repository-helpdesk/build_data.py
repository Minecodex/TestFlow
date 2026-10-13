"""Package the fixed synthetic inputs and matching portable test sets."""
import hashlib
import json
from pathlib import Path

from testflow.features.assets.transfer import pack_assets
from testflow.features.assets.transfer_contracts import AssetPackage
from testflow.features.datasets.transfer_contracts import DatasetDocument

DIRECTORY = Path(__file__).resolve().parent


def build_data(index):
    assets, files = [], {}
    for key, filename, kind, source in [("query", "query.txt", "Text", "example-text"),
            ("voice", "question.wav", "Audio", "synthetic-audio"), ("image", "question.png", "Image", "generated-image")]:
        content = (DIRECTORY / "inputs" / filename).read_bytes()
        path = "files/" + filename
        files[path] = content
        assets.append({"key": key, "name": "Helpdesk example · " + filename, "type": kind,
            "format": {"Text": "UTF-8", "Audio": "WAV · 16kHz · Mono", "Image": "Image/*"}[kind],
            "file": {"path": path, "size": len(content), "sha256": hashlib.sha256(content).hexdigest()},
            "tags": ["example", "repository-helpdesk", key], "category": "Helpdesk", "source": source,
            "reference": "What is the refund policy?" if kind != "Text" else None, "reference_confirmed": kind != "Text"})
    document = AssetPackage.model_validate({"format": "testflow.assets.v1", "assets": assets})
    target = DIRECTORY / "downloads/assets/helpdesk.assets.zip"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(pack_assets(document, files))
    index["assets"] = [{"file": "downloads/assets/helpdesk.assets.zip", "sha256": hashlib.sha256(target.read_bytes()).hexdigest(), "count": 3}]
    index["datasets"] = []
    for modality in ["retrieval", "text", "voice", "image"]:
        workflow = json.loads((DIRECTORY / "workflows" / (modality + ".workflow.json")).read_text())["pipeline"]
        asset = next(a for a in document.assets if a.key == (modality if modality in {"voice", "image"} else "query"))
        value = DatasetDocument.model_validate({"format": "testflow.dataset.v1", "assets": [{
            "key": asset.key, "name": asset.name, "type": asset.type, "format": asset.format,
            "sha256": asset.file.sha256, "revision_digest": asset.revision_digest()}], "dataset": {
            "name": "GitHub example case · " + modality,
            "description": "Fixed synthetic inputs; pairs with GitHub example · " + modality,
            "input_schema": workflow["input_schema"],
            "cases": [{"key": "refund", "name": "Refund policy · " + modality,
                "inputs": {workflow["input_schema"]["fields"][0]["name"]: {"asset_key": asset.key}}}]}})
        path = DIRECTORY / "datasets" / (modality + ".dataset.json")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value.model_dump(mode="json"), ensure_ascii=False, indent=2) + "\n")
        index["datasets"].append({"file": "datasets/" + path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "workflow": "workflows/" + modality + ".workflow.json"})
    return index
