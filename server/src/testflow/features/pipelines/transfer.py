"""Resolve portable dependencies against immutable local revisions before saving."""
from copy import deepcopy

from fastapi import HTTPException
from sqlalchemy import select

from testflow.core.contracts import PipelineBody
from testflow.core.errors import fail
from testflow.features.pipelines.service import resolve_graph, validate_graph
from testflow.features.pipelines.transfer_contracts import WorkflowDocument, WorkflowImport, WorkflowPreview
from testflow.infrastructure.models import Credential, Resource, Revision
from testflow.infrastructure.redaction import credential_refs
from testflow.infrastructure.revisions import get_resource


def set_path(value, path, replacement):
    for part in path[:-1]:
        value = value[part]
    value[path[-1]] = replacement


def leaves(value, prefix=()):
    if isinstance(value, dict):
        for key, item in value.items():
            yield from leaves(item, (*prefix, key))
    elif isinstance(value, list):
        for key, item in enumerate(value):
            yield from leaves(item, (*prefix, key))
    else:
        yield list(prefix), value


def credential_path(schema, parameters, path):
    probe = deepcopy(parameters)
    marker = "testflow-portable-credential-probe"
    set_path(probe, path, marker)
    return marker in credential_refs(schema, probe)


async def export_workflow(db, body: PipelineBody) -> WorkflowDocument:
    # Resolving also verifies parameter references and pinned repository revisions.
    graph = await resolve_graph(db, body)
    document = {"format": "testflow.workflow.v1", "pipeline": body.model_dump(mode="json"),
                "modules": [], "repositories": [], "credentials": []}
    modules, repositories, credentials = {}, {}, {}

    async def credential_key(identifier, kind):
        if identifier not in credentials:
            row = await db.get(Credential, identifier)
            if row is None or row.kind != kind:
                fail("credential_unavailable", "Select an existing credential before exporting")
            key = "credential_" + str(len(credentials) + 1)
            credentials[identifier] = key
            document["credentials"].append({"key": key, "name": row.name, "kind": kind})
        return credentials[identifier]

    for original, node in zip(graph["nodes"], document["pipeline"]["nodes"]):
        node.pop("module_id", None)
        node.pop("module_version", None)
        if node["kind"] != "module":
            node["runtime"] = None
            continue
        module = original["module_snapshot"]
        data = module["data"]
        identity = data["package_digest"]
        if identity not in modules:
            key = "module_" + str(len(modules) + 1)
            modules[identity] = key
            document["modules"].append({"key": key, "id": data["manifest"]["id"],
                                         "version": data["manifest"]["version"], "package_digest": identity})
        node["module_key"] = modules[identity]
        # Freeze the effective runtime, including a default runtime originally omitted by the author.
        runtime = deepcopy(original["runtime"])
        registry = runtime.pop("registry_credential_id", None)
        runtime["registry_credential_key"] = await credential_key(registry, "registry") if registry else None
        if runtime.get("code_mount"):
            repo = original["repository_snapshot"]
            identity = (repo["data"]["url"], runtime["code_mount"]["commit"])
            if identity not in repositories:
                key = "repository_" + str(len(repositories) + 1)
                repositories[identity] = key
                document["repositories"].append({"key": key, "name": repo["name"], "url": identity[0], "commit": identity[1]})
            runtime["code_mount"] = {"repository_key": repositories[identity], "commit": identity[1],
                                      "mount_path": runtime["code_mount"]["mount_path"]}
        node["runtime"] = runtime
        references = credential_refs(data["parameters"], node["parameters"])
        node["parameter_credentials"] = []
        for path, value in list(leaves(node["parameters"])):
            if isinstance(value, str) and value in references and credential_path(data["parameters"], node["parameters"], path):
                node["parameter_credentials"].append({"path": path, "credential_key": await credential_key(value, "module")})
                set_path(node["parameters"], path, None)
    return WorkflowDocument.model_validate(document)


async def preview_workflow(db, body: WorkflowImport) -> WorkflowPreview:
    document = body.document
    requirements, selections, errors = [], {}, []
    keys = {r.key for r in [*document.modules, *document.repositories, *document.credentials]}
    if set(body.bindings) - keys:
        fail("unknown_workflow_binding", "Bindings contain unknown dependency keys")
    # Include old immutable revisions, so an update cannot silently replace a pinned package/commit.
    revisions = (await db.execute(select(Resource, Revision).join(Revision, Resource.id == Revision.resource_id)
                                  .where(Resource.kind.in_(["modules", "repositories"]), Resource.hidden.is_(False))
                                  .order_by(Revision.number.desc()))).all()
    vault = (await db.scalars(select(Credential).order_by(Credential.created))).all()

    def requirement(dependency, kind, name, identity, options):
        supplied = body.bindings.get(dependency.key)
        selected = None
        if supplied:
            selected = next((o for o in options if o["id"] == supplied.id and o["version"] == supplied.version), None)
            if selected is None:
                errors.append({"code": "binding_mismatch", "key": dependency.key,
                               "message": "Selected resource does not match the fixed dependency"})
        elif kind != "credential" and len(options) == 1:
            selected = options[0]
        selection = {"id": selected["id"], "version": selected["version"]} if selected else None
        if selection:
            selections[dependency.key] = selection
        requirements.append({"key": dependency.key, "kind": kind, "name": name, "identity": identity,
                             "state": "resolved" if selection else "selection_required" if options else "missing",
                             "options": options, "selected": selection})

    for dependency in document.modules:
        options = [{"id": resource.id, "version": revision.number, "name": resource.name}
                   for resource, revision in revisions if resource.kind == "modules"
                   and revision.data["manifest"]["id"] == dependency.id
                   and revision.data["manifest"]["version"] == dependency.version
                   and revision.data["package_digest"] == dependency.package_digest]
        requirement(dependency, "module", dependency.id, dependency.version + " · " + dependency.package_digest, options)
    for dependency in document.repositories:
        options = [{"id": resource.id, "version": revision.number, "name": resource.name}
                   for resource, revision in revisions if resource.kind == "repositories"
                   and revision.data["url"] == dependency.url and revision.data.get("commit") == dependency.commit
                   and revision.data.get("code_path")]
        # Re-syncing an identical commit may produce several revisions; choose the newest per resource.
        options = list({option["id"]: option for option in reversed(options)}.values())
        requirement(dependency, "repository", dependency.name, dependency.url + " @ " + dependency.commit, options)
    for dependency in document.credentials:
        options = [{"id": row.id, "version": None, "name": row.name} for row in vault if row.kind == dependency.kind]
        requirement(dependency, "credential", dependency.name, dependency.kind, options)

    pipeline = None
    if len(selections) == len(keys) and not errors:
        value = document.pipeline.model_dump(mode="json")
        if body.name:
            value["name"] = body.name
        for node in value["nodes"]:
            key = node.pop("module_key")
            bindings = node.pop("parameter_credentials")
            if key:
                selected = selections[key]
                node.update(module_id=selected["id"], module_version=selected["version"])
                module = await get_resource(db, "modules", selected["id"], selected["version"])
                for binding in bindings:
                    if not credential_path(module["data"]["parameters"], node["parameters"], binding["path"]):
                        errors.append({"code": "invalid_credential_path", "node_id": node["id"],
                                       "message": "Credential binding must target a Schema-declared credential field"})
                    set_path(node["parameters"], binding["path"], selections[binding["credential_key"]]["id"])
                declared = {tuple(binding["path"]) for binding in bindings}
                if any(isinstance(value, str) and value and tuple(path) not in declared
                       and credential_path(module["data"]["parameters"], node["parameters"], path)
                       for path, value in leaves(node["parameters"])):
                    errors.append({"code": "credential_binding_required", "node_id": node["id"],
                                   "message": "Portable credential fields must be explicitly rebound"})
            if node["runtime"]:
                runtime = node["runtime"]
                registry = runtime.pop("registry_credential_key")
                runtime["registry_credential_id"] = selections[registry]["id"] if registry else None
                if runtime["code_mount"]:
                    mount = runtime["code_mount"]
                    repo = selections[mount.pop("repository_key")]
                    mount.update(repository_id=repo["id"], repository_version=repo["version"])
        if not errors:
            try:
                pipeline = PipelineBody.model_validate(value)
                graph = await resolve_graph(db, pipeline)
                errors.extend(validate_graph(graph))
            except HTTPException as error:
                errors.append(error.detail)
    return WorkflowPreview(valid=not errors and pipeline is not None, requirements=requirements, errors=errors, pipeline=pipeline)
