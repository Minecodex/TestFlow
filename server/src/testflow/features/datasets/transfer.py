from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError

from testflow.core.contracts import DatasetBody
from testflow.features.assets.transfer import asset_candidates, describe_asset
from testflow.features.assets.transfer_contracts import ResourceSelection
from testflow.features.datasets.transfer_contracts import DatasetDocument, DatasetPreview, DatasetRequirement
from testflow.features.datasets.validation import validate_dataset
from testflow.infrastructure.revisions import get_resource


async def export_dataset(db, root, body, *, follow_latest=True):
    dependencies, cases = {}, []
    async def dependency(identifier, version=None):
        resource = await get_resource(db, "assets", identifier, None if follow_latest else version)
        asset, _ = describe_asset(resource["data"], root)
        identity = asset.revision_digest()
        if identity not in dependencies:
            dependencies[identity] = {"key": "asset-" + str(len(dependencies) + 1), "name": asset.name,
                "type": asset.type, "format": asset.format, "sha256": asset.file.sha256, "revision_digest": identity}
        return dependencies[identity]["key"]
    for i, case in enumerate(body.cases):
        inputs = {}
        for name, binding in case.inputs.items():
            if binding.asset_id:
                inputs[name] = {"asset_key": await dependency(binding.asset_id, binding.asset_version)}
            else:
                inputs[name] = {"value": binding.value}
        cases.append({"key": "case-" + str(i + 1), "name": case.name, "inputs": inputs})
    return DatasetDocument.model_validate({"format": "testflow.dataset.v1", "assets": list(dependencies.values()),
        "dataset": {**body.model_dump(mode="json", exclude={"cases"}), "cases": cases}})


async def preview_dataset(db, root, body):
    dependencies = body.document.assets
    candidates = await asset_candidates(db, root, {a.sha256 for a in dependencies}) if dependencies else {}
    requirements, bindings, errors = [], {}, []
    unknown = set(body.bindings) - {a.key for a in dependencies}
    if unknown:
        errors.append({"code": "unknown_asset_key", "keys": sorted(unknown)})
    for dep in dependencies:
        matches = candidates.get(dep.revision_digest, [])
        # Type/format/name/checksum metadata cannot override the revision identity.
        matching = []
        for item in matches:
            data = (await get_resource(db, "assets", item["id"], item["version"]))["data"]
            if (data["type"], data["format"], data["sha256"], data["name"]) == (dep.type, dep.format, dep.sha256, dep.name):
                matching.append(item)
        selected = body.bindings.get(dep.key)
        chosen = next((c for c in matching if selected and c["id"] == selected.id and (selected.version is None or c["version"] == selected.version)), None) if selected else (matching[0] if len(matching) == 1 else None)
        if selected and selected.version is None:
            # Selection must freeze a fixed revision, not silently choose an old one.
            try:
                current = await get_resource(db, "assets", selected.id)
                chosen = next((c for c in matching if c["id"] == selected.id and c["version"] == current["version"]), None)
            except HTTPException:
                chosen = None
        state = "resolved" if chosen else "invalid_binding" if selected else "missing" if not matching else "selection_required"
        requirement = DatasetRequirement(**dep.model_dump(), candidates=matching, state=state,
            selected=ResourceSelection(id=chosen["id"], version=chosen["version"]) if chosen else None)
        requirements.append(requirement)
        if chosen:
            bindings[dep.key] = {"asset_id": chosen["id"], "asset_version": chosen["version"]}
    resolved = None
    if all(r.state == "resolved" for r in requirements) and not errors:
        cases = [{"id": str(uuid4()), "name": c.name,
            "inputs": {name: bindings[b.asset_key] if b.asset_key else {"value": b.value} for name, b in c.inputs.items()}} for c in body.document.dataset.cases]
        try:
            resolved = DatasetBody.model_validate({**body.document.dataset.model_dump(mode="json", exclude={"cases"}),
                "name": body.name or body.document.dataset.name, "cases": cases})
            await validate_dataset(db, resolved)
        except (ValidationError, HTTPException) as error:
            errors.append(error.detail if isinstance(error, HTTPException) else {"code": "invalid_dataset", "message": str(error)})
            resolved = None
    return DatasetPreview(valid=resolved is not None and not errors, requirements=requirements, errors=errors, dataset=resolved)
