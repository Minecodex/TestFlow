import { DeleteAction } from "../../shared/ui";
import { useResourceOptions } from "../../shared/api/hooks";
import { useMutation } from "@tanstack/react-query";
import { useListState } from "../../shared/ui/list-state";
import {Pagination} from "../../shared/ui";
import { useEffect, useMemo, useState, useRef } from "react";
import {
  useBlocker,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowRight,
  Boxes,
  Download,
  History,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  X,
  Upload,
  Workflow,
} from "lucide-react";
import { useMessages } from "../../i18n";
import { ApiError, getJson, write } from "../../shared/api/client";
import { useResource, useResources, useWrite } from "../../shared/api/hooks";
import type {
  GraphNode,
  Module,
  Pipeline,
  Resource,
  Schema,
  WorkflowDocument,
} from "../../shared/api/types";
import { textSchema } from "../../shared/api/types";
import { ResourceCard } from "../../shared/ui/resource-card";
import { FlowIcon } from "../../shared/icons";
import {Action, Badge, Chips, Choice, Dialog, Empty, Failure, Head, Json, Notice, SchemaEditor, Text, download, useUnload} from "../../shared/ui";
import { DeleteResource, Versions } from "../../shared/ui/resources";
import { Canvas } from "./canvas";
import { Inspector, useGraphModules } from "./inspector";
import { moduleRuntime } from "../modules/config";
import { ModuleVersion } from "../modules/version";
import { QuickRun } from "./quick";
import { ImportWorkflow } from "./transfer";
import { parameterErrors, schemaIssues } from "../../shared/schema/validation";
import { DraftConflict, restoreDraft } from "../../shared/ui/draft-conflict";
import { RequestState } from "../../shared/ui/request-state";
function newPipeline(
  name: string,
  startName: string,
  endName: string,
  inputSchema: Schema = textSchema,
  outputSchema: Schema = textSchema,
): Pipeline {
  return {
    name,
    description: "",
    input_schema: structuredClone(inputSchema),
    output_schema: structuredClone(outputSchema),
    preparation_timeout: 60,
    cleanup_timeout: 10,
    nodes: [
      {
        id: "start",
        kind: "start",
        description: "",
        name: startName,
        x: 40,
        y: 200,
        output_schema: structuredClone(inputSchema),
        parameters: {},
        mappings: [],
        timeout: 30,
      },
      {
        id: "end",
        kind: "end",
        description: "",
        name: endName,
        x: 440,
        y: 200,
        input_schema: structuredClone(outputSchema),
        output_schema: structuredClone(outputSchema),
        parameters: {},
        mappings: [],
        timeout: 30,
      },
    ],
    edges:
      JSON.stringify(inputSchema) === JSON.stringify(outputSchema)
        ? [{ source: "start", target: "end" }]
        : [],
  };
}
function Designer({ resource }: { resource: Resource<Pipeline> }) {
  const t = useMessages();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const draftKey = "testflow.pipeline-draft." + resource.id;
  const [restored] = useState(() =>
    restoreDraft(draftKey, resource.version, resource.data),
  );
  const [baseVersion, setBaseVersion] = useState(restored.baseVersion);
  const [saved, setSaved] = useState(resource.data);
  const [draft, setDraft] = useState<Pipeline>(restored.data);
  const [schemaMode, setSchemaMode] = useState("");
  const [schemaInput, setSchemaInput] = useState<Schema>(draft.input_schema);
  const [schemaOutput, setSchemaOutput] = useState<Schema>(draft.output_schema);
  const [removeEdge, setRemoveEdge] = useState<{
    source: string;
    target: string;
  }>();
  const [quick, setQuick] = useState(false);
  const [validationSignature, setValidationSignature] = useState("");
  const [settings, setSettings] = useState(false);
  const [nodeSettings, setNodeSettings] = useState<Record<string, Partial<GraphNode>>>({});
  const [nodeVersions, setNodeVersions] = useState<Record<string, Resource<Module>>>({});
  const [library, setLibrary] = useState(false);
  const [moduleSearch, setModuleSearch] = useState("");
  const closeLibrary = () => {
    setLibrary(false);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>('[data-a="toggle-node-library"]')
        ?.focus(),
    );
  };
  const [inspecting, setInspecting] = useState(!!params.get("node"));
  const [metadata, setMetadata] = useState({
    name: draft.name,
    description: draft.description || "",
    preparation_timeout: draft.preparation_timeout ?? 60,
    cleanup_timeout: draft.cleanup_timeout ?? 10,
  });
  const settingsValid =
    Number.isFinite(metadata.preparation_timeout) &&
    metadata.preparation_timeout > 0 &&
    metadata.preparation_timeout <= 3600 &&
    Number.isFinite(metadata.cleanup_timeout) &&
    metadata.cleanup_timeout > 0 &&
    metadata.cleanup_timeout <= 300 && Object.values(nodeSettings).every(node => node.timeout == null || Number.isFinite(node.timeout) && node.timeout > 0 && node.timeout <= 86400);
  const modules = useResourceOptions<Module>("modules");
  const nodeModules = useGraphModules(draft);
  const selected = params.get("node") || undefined;
  const graph = useMemo(
    () => ({
      ...draft,
      nodes: draft.nodes.map((n) =>
        n.kind === "start"
          ? { ...n, output_schema: draft.input_schema }
          : n.kind === "end"
            ? {
                ...n,
                input_schema: draft.output_schema,
                output_schema: draft.output_schema,
              }
            : n.kind === "module" && nodeModules[n.id]
              ? {
                  ...n,
                  input_schema: nodeModules[n.id]!.data.inputs,
                  output_schema: nodeModules[n.id]!.data.outputs,
                }
              : n,
      ),
    }),
    [draft, nodeModules],
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const exporting = useMutation({
    mutationFn: () => write<WorkflowDocument>("/pipelines/export", draft),
  });
  const invalidParameters = draft.nodes.filter(
    (node) =>
      node.kind === "module" &&
      nodeModules[node.id] &&
      parameterErrors(nodeModules[node.id]!.data.parameters, node.parameters)
        .length > 0,
  );
  const invalidSchema =
    schemaIssues(draft.input_schema).length > 0 ||
    schemaIssues(draft.output_schema).length > 0;
  useUnload(dirty);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    try {
      if (dirty)
        localStorage.setItem(
          draftKey,
          JSON.stringify({ base_version: baseVersion, data: draft }),
        );
      else localStorage.removeItem(draftKey);
    } catch {}
  }, [draft, draftKey, baseVersion, dirty]);
  const save = useWrite(() =>
    write<Resource<Pipeline>>(
      `/pipelines/${resource.id}`,
      { expected_version: baseVersion, data: draft },
      "PUT",
    ),
  );
  const validation = useWrite(() =>
    write<{ valid: boolean; errors: { message: string; node_id?: string }[] }>(
      "/pipelines/validate",
      draft,
    ),
  );
  const conflict =
    resource.version > baseVersion ||
    (save.error instanceof ApiError && save.error.status === 409);
  const saveNow = () => {
    if (invalidSchema || invalidParameters.length || conflict || save.isPending)
      return;
    save.mutate(undefined, {
      onSuccess: (result) => {
        setBaseVersion(result.version);
        setSaved(result.data);
        setDraft(result.data);
      },
    });
  };
  useEffect(() => {
    const saveShortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== "s"
      )
        return;
      event.preventDefault();
      if (!document.querySelector('[role="dialog"]:not(.testflow-node-drawer)'))
        saveNow();
    };
    window.addEventListener("keydown", saveShortcut);
    return () => window.removeEventListener("keydown", saveShortcut);
  }, [saveNow]);
  const patchNode = (node: GraphNode) =>
    setDraft({
      ...draft,
      nodes: draft.nodes.map((n) => (n.id === node.id ? node : n)),
    });
  const addNode = (kind: GraphNode["kind"], module?: Resource<Module>) => {
    const id = crypto.randomUUID();
    // Choose a free grid cell even after users move or remove existing nodes.
    let position = { x: 240, y: 60 };
    for (let cell = 0; ; cell++) {
      const candidate = {
        x: 240 + (cell % 3) * 280,
        y: 60 + Math.floor(cell / 3) * 240,
      };
      if (
        !draft.nodes.some(
          (existing) =>
            Math.abs((existing.x || 0) - candidate.x) < 230 &&
            Math.abs((existing.y || 0) - candidate.y) < 210,
        )
      ) {
        position = candidate;
        break;
      }
    }
    const source = graph.input_schema;
    const node: GraphNode = {
      id,
      kind,
      name:
        module?.name ||
        t.pipelines[
          kind === "end"
            ? "end"
            : kind === "assembly"
              ? "assembly"
              : "conversion"
        ],
      ...position,
      parameters: structuredClone(module?.data.manifest.defaults || {}),
      description: "",
      timeout: 30,
      mappings: [],
      input_schema:
        kind === "end"
          ? draft.output_schema
          : kind === "conversion"
            ? source
            : module?.data.inputs || null,
      output_schema:
        kind === "end"
          ? draft.output_schema
          : kind === "assembly"
            ? draft.output_schema
            : kind === "conversion"
              ? { fields: source.fields.map((f) => ({ ...f, stream: false })) }
              : module?.data.outputs || null,
      module_id: module?.id,
      module_version: module?.selected_version,
      runtime: module ? structuredClone(moduleRuntime(module.data)) : undefined,
      direction: kind === "conversion" ? "to_full" : null,
    };
    setDraft({ ...draft, nodes: [...draft.nodes, node] });
    setLibrary(false);
    setInspecting(false);
    setParams({ ...Object.fromEntries(params), node: id });
  };
  const deleteNode = (id = selected) => {
    if (
      !id ||
      draft.nodes.find((n) => n.id === id)?.kind === "start"
    )
      return;
    setDraft({
      ...draft,
      nodes: draft.nodes.filter((n) => n.id !== id),
      edges: draft.edges.filter(
        (e) => e.source !== id && e.target !== id,
      ),
    });
    setInspecting(false);
    setParams({});
  };
  const selectedNode = graph.nodes.find((n) => n.id === selected);
  const openSchema = () => {
    const mode =
      selectedNode?.kind === "assembly"
        ? "assembly"
        : selectedNode?.kind === "conversion"
          ? "conversion"
          : "flow";
    setSchemaMode(mode);
    setSchemaInput(selectedNode?.input_schema || draft.input_schema);
    setSchemaOutput(selectedNode?.output_schema || draft.output_schema);
  };
  const inserted = useRef(false);
  const requestedModule = useResource<Module>(
    "modules",
    params.get("module") || undefined,
    params.get("module_version") || undefined,
  );
  useEffect(() => {
    if (requestedModule.data && !inserted.current) {
      inserted.current = true;
      addNode("module", requestedModule.data);
    }
  }, [requestedModule.data]);
  return (
    <>
      <Head
        title={draft.name}
        actions={
          <>
            <Action action="flow-list" onPress={() => navigate("/pipelines")}>
              {t.pipelines.list}
            </Action>
            <Action
              action="validate-flow"
              isPending={validation.isPending}
              onPress={() =>
                validation.mutate(undefined, {
                  onSuccess: () =>
                    setValidationSignature(JSON.stringify(draft)),
                })
              }
            >
              {t.pipelines.validate}
            </Action>
            <Action
              primary
              action="save-flow"
              isDisabled={
                invalidSchema || invalidParameters.length > 0 || conflict
              }
              isPending={save.isPending}
              onPress={saveNow}
            >
              <Save />
              {t.common.save}
            </Action>
          </>
        }
      />
      <div className="testflow-pipeline-bar">
        <div className="testflow-row">
          <Badge state={dirty ? "pending" : "ready"}>
            {dirty ? t.pipelines.draft : `${t.pipelines.saved} v${baseVersion}`}
          </Badge>
          <Action
            size="sm"
            action="revert-flow"
            isDisabled={!dirty}
            onPress={() => setDraft(structuredClone(saved))}
          >
            <RotateCcw />
            {t.pipelines.revert}
          </Action>
        </div>
        <div className="testflow-row">
          <Action
            size="sm"
            action="export-flow"
            isPending={exporting.isPending}
            onPress={() =>
              exporting.mutate(undefined, {
                onSuccess: (document) =>
                  download(`${draft.name}.workflow.json`, document),
              })
            }
          >
            <Download />
            {t.pipelines.exportWorkflow}
          </Action>
          <Action
            primary
            size="sm"
            action="quick-run"
            isDisabled={dirty || invalidSchema || invalidParameters.length > 0}
            onPress={() => setQuick(true)}
          >
            {t.pipelines.quick}
          </Action>
        </div>
      </div>
      <Failure
        error={
          save.error ||
          validation.error ||
          requestedModule.error ||
          exporting.error
        }
      />
      {conflict && !(inspecting && selectedNode) && (
        <DraftConflict
          kind="pipelines"
          id={resource.id}
          draft={draft}
          onContinue={(latest) => {
            setBaseVersion(latest.version);
            setSaved(latest.data);
            save.reset();
          }}
        />
      )}
      {invalidParameters.length > 0 && (
        <Notice error>
          {t.modules.parametersInvalid} ·{" "}
          {invalidParameters.map((node) => node.name).join("、")}
        </Notice>
      )}
      {validation.data && validationSignature === JSON.stringify(draft) && (
        <Notice error={!validation.data.valid}>
          {validation.data.valid
            ? t.pipelines.ready
            : validation.data.errors.map((e, i) => (
                <div key={i}>
                  {e.node_id} · {e.message}
                </div>
              ))}
        </Notice>
      )}
      <div className="testflow-designer">
        <Canvas
          value={graph}
          onChange={setDraft}
          selected={selected}
          onSelect={(node) => {
            setParams(node ? { node } : {});
            if (!node) setInspecting(false);
          }}
          onInspect={(node) => {
            setParams({ node });
            setLibrary(false);
            setInspecting(true);
          }}
          onRemoveEdge={(source, target) => setRemoveEdge({ source, target })}
          onDelete={() => deleteNode()}
          onRemoveNode={deleteNode}
          onSave={saveNow}
          tools={
            <>
              <Action
                size="sm"
                action="flow-settings"
                aria-label={t.pipelines.settings}
                onPress={() => {
                  setNodeSettings({});
                  setNodeVersions({});
                  setMetadata({
                    name: draft.name,
                    description: draft.description || "",
                    preparation_timeout: draft.preparation_timeout ?? 60,
                    cleanup_timeout: draft.cleanup_timeout ?? 10,
                  });
                  setSettings(true);
                }}
              >
                <Settings2 />
                {t.pipelines.settings}
              </Action>
              <Action
                size="sm"
                isIconOnly
                action="toggle-node-library"
                aria-label={t.pipelines.addNode}
                aria-expanded={library}
                aria-controls="testflow-node-library"
                onPress={() => setLibrary(!library)}
              >
                <Plus />
              </Action>
            </>
          }
          library={
            library ? (
              <aside
                id="testflow-node-library"
                className="testflow-palette"
                aria-label={t.pipelines.palette}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    closeLibrary();
                  }
                }}
              >
                <div className="testflow-row testflow-between">
                  <h3>{t.pipelines.palette}</h3>
                  <Action
                    size="sm"
                    isIconOnly
                    variant="ghost"
                    aria-label={t.pipelines.closeLibrary}
                    onPress={closeLibrary}
                  >
                    <X />
                  </Action>
                </div>
                <Text
                  label={t.pipelines.searchModules}
                  value={moduleSearch}
                  onChange={setModuleSearch}
                />
                <div className="testflow-palette-label">
                  {t.pipelines.importedModules}
                </div>
                <Failure error={modules.error} />
                {modules.data?.items
                  .filter((m) =>
                    m.name
                      .toLocaleLowerCase()
                      .includes(moduleSearch.toLocaleLowerCase()),
                  )
                  .map((m) => (
                    <Action
                      size="sm"
                      action="add-node"
                      key={m.id}
                      onPress={() => addNode("module", m)}
                    >
                      <Boxes />
                      <span className="testflow-palette-name">{m.name}</span>
                    </Action>
                  ))}
                {modules.data &&
                  !modules.data.items.some((m) =>
                    m.name
                      .toLocaleLowerCase()
                      .includes(moduleSearch.toLocaleLowerCase()),
                  ) && (
                    <p className="testflow-small testflow-muted">
                      {t.common.emptySearch}
                    </p>
                  )}
                <div className="testflow-palette-label">
                  {t.pipelines.builtInNodes}
                </div>
                {(["end", "assembly", "conversion"] as const).map((kind) => (
                  <Action
                    key={kind}
                    action="add-node"
                    size="sm"
                    onPress={() => addNode(kind)}
                  >
                    <span className="testflow-palette-name">
                      {t.pipelines[kind]}
                    </span>
                  </Action>
                ))}
              </aside>
            ) : undefined
          }
        />
      </div>
      {inspecting && selectedNode && (
        <Dialog
          drawer
          className="testflow-node-drawer"
          title={selectedNode.name}
          onClose={() => setInspecting(false)}
          footer={
            <Action onPress={() => setInspecting(false)}>
              {t.common.close}
            </Action>
          }
        >
          <Failure error={save.error} />
          {conflict && (
            <DraftConflict
              kind="pipelines"
              id={resource.id}
              draft={draft}
              onContinue={(latest) => {
                setBaseVersion(latest.version);
                setSaved(latest.data);
                save.reset();
              }}
            />
          )}
          <Inspector
            node={selectedNode}
            graph={graph}
            module={selected ? nodeModules[selected] : undefined}
            onChange={patchNode}
            onSchema={openSchema}
            onContractChange={(kind, schema) =>
              setDraft({
                ...draft,
                ...(kind === "start"
                  ? { input_schema: schema }
                  : { output_schema: schema }),
                nodes: draft.nodes.map((n) =>
                  n.kind === kind
                    ? {
                        ...n,
                        ...(kind === "start"
                          ? { output_schema: schema }
                          : { input_schema: schema, output_schema: schema }),
                      }
                    : n,
                ),
              })
            }
          />
        </Dialog>
      )}
      {schemaMode && (
        <Dialog
          title={t.pipelines.schemaEdit}
          wide
          onClose={() => setSchemaMode("")}
          footer={
            <>
              <Action onPress={() => setSchemaMode("")}>
                {t.common.cancel}
              </Action>
              <Action
                primary
                isDisabled={
                  (schemaMode !== "assembly" &&
                    schemaIssues(schemaInput).length > 0) ||
                  (schemaMode !== "conversion" &&
                    schemaIssues(schemaOutput).length > 0)
                }
                action={
                  schemaMode === "assembly"
                    ? "save-assembly-schema"
                    : "save-flow-schema"
                }
                onPress={() => {
                  if (schemaMode === "flow")
                    setDraft({
                      ...draft,
                      input_schema: schemaInput,
                      output_schema: schemaOutput,
                    });
                  else if (schemaMode === "assembly" && selectedNode)
                    patchNode({
                      ...selectedNode,
                      output_schema: schemaOutput,
                      mappings: selectedNode.mappings?.filter((m) =>
                        schemaOutput.fields.some((f) => f.name === m.target),
                      ),
                    });
                  else if (selectedNode)
                    patchNode({
                      ...selectedNode,
                      input_schema: schemaInput,
                      output_schema: {
                        fields: schemaInput.fields.map((f) => ({
                          ...f,
                          stream:
                            selectedNode.direction === "to_stream" &&
                            f.type !== "JSON",
                        })),
                      },
                    });
                  setSchemaMode("");
                }}
              >
                {t.common.save}
              </Action>
            </>
          }
        >
          <div className="testflow-stack">
            {schemaMode !== "assembly" && (
              <>
                <h3>{t.common.inputSchema}</h3>
                <SchemaEditor value={schemaInput} onChange={setSchemaInput} />
              </>
            )}
            {schemaMode !== "conversion" && (
              <>
                <h3>{t.common.outputSchema}</h3>
                <SchemaEditor value={schemaOutput} onChange={setSchemaOutput} />
              </>
            )}
          </div>
        </Dialog>
      )}
      {settings && (
        <Dialog
          title={t.pipelines.settings}
          onClose={() => setSettings(false)}
          footer={
            <>
              <Action onPress={() => setSettings(false)}>
                {t.common.cancel}
              </Action>
              <Action
                primary
                isDisabled={!metadata.name.trim() || !settingsValid}
                onPress={() => {
                  setDraft({ ...draft, ...metadata, nodes: draft.nodes.map(node => ({...node, ...nodeSettings[node.id]})) });
                  setSettings(false);
                }}
              >
                {t.common.save}
              </Action>
            </>
          }
        >
          <div className="testflow-stack">
            {!settingsValid && (
              <Notice error>{t.pipelines.settingsInvalid}</Notice>
            )}
            <Text
              label={t.common.name}
              value={metadata.name}
              onChange={(name) => setMetadata({ ...metadata, name })}
              required
            />
            <Text
              label={t.common.description}
              value={metadata.description}
              onChange={(description) =>
                setMetadata({ ...metadata, description })
              }
              multiline
            />
            <div className="testflow-form-row">
              <Text
                label={t.pipelines.prepareTimeout}
                type="number"
                value={metadata.preparation_timeout}
                onChange={(value) =>
                  setMetadata({
                    ...metadata,
                    preparation_timeout: Number(value),
                  })
                }
              />
              <Text
                label={t.pipelines.cleanupTimeout}
                type="number"
                value={metadata.cleanup_timeout}
                onChange={(value) =>
                  setMetadata({ ...metadata, cleanup_timeout: Number(value) })
                }
              />
            </div>
            <details className="testflow-node-platform-settings">
              <summary>{t.pipelines.nodeSettings}</summary>
              {graph.nodes.map(node => <div key={node.id} className="testflow-stack testflow-node-setting">
                <strong>{node.name}</strong>
                <Text label={`${node.name} · ${t.pipelines.nodeTimeout}`} type="number"
                  value={nodeSettings[node.id]?.timeout ?? node.timeout ?? 30}
                  onChange={value => setNodeSettings({...nodeSettings, [node.id]: {...nodeSettings[node.id], timeout: Number(value)}})} />
                {node.kind === "module" && (nodeVersions[node.id] || nodeModules[node.id]) &&
                  <ModuleVersion module={nodeVersions[node.id] || nodeModules[node.id]!} onSelect={pinned => {
                    setNodeVersions({...nodeVersions, [node.id]: pinned});
                    setNodeSettings({...nodeSettings, [node.id]: {...nodeSettings[node.id], module_version: pinned.selected_version,
                      input_schema: pinned.data.inputs, output_schema: pinned.data.outputs, runtime: structuredClone(moduleRuntime(pinned.data)),
                      parameters: structuredClone(pinned.data.manifest.defaults || {})}});
                  }} />}
              </div>)}
            </details>
          </div>
        </Dialog>
      )}
      {removeEdge && (
        <Dialog
          title={t.pipelines.removeEdge}
          onClose={() => setRemoveEdge(undefined)}
          footer={
            <>
              <Action onPress={() => setRemoveEdge(undefined)}>
                {t.common.cancel}
              </Action>
              <DeleteAction
                danger
                action="confirm-edge-delete"
                onPress={() => {
                  setDraft({
                    ...draft,
                    edges: draft.edges.filter(
                      (e) =>
                        e.source !== removeEdge.source ||
                        e.target !== removeEdge.target,
                    ),
                  });
                  setRemoveEdge(undefined);
                }}
              >
                {t.common.remove}
              </DeleteAction>
            </>
          }
        >
          <Notice>{t.pipelines.edgeConfirm}</Notice>
        </Dialog>
      )}
      {quick && (
        <QuickRun
          pipeline={{ ...resource, data: saved, selected_version: baseVersion }}
          onClose={() => setQuick(false)}
        />
      )}{" "}
      {blocker.state === "blocked" && (
        <Dialog
          title={t.common.unsaved}
          onClose={() => blocker.reset()}
          footer={
            <>
              <Action onPress={() => blocker.reset()}>{t.common.stay}</Action>
              <Action primary onPress={() => blocker.proceed()}>
                {t.common.keepDraft}
              </Action>
            </>
          }
        >
          <Notice>{t.pipelines.draft}</Notice>
        </Dialog>
      )}
    </>
  );
}
export function PipelinesPage() {
  const t = useMessages();
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const selected = useResource<Pipeline>("pipelines", id);
  const pendingModule = useResource<Module>(
    "modules",
    params.get("module") || undefined,
    params.get("module_version") || undefined,
  );
  const list = useListState();
  const query = useResources<Pipeline>("pipelines", list.query);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [name, setName] = useState("");
  const [startName, setStartName] = useState(t.pipelines.start);
  const [inputPreset, setInputPreset] = useState("plain");
  const [outputPreset, setOutputPreset] = useState("same");
  const presets: Record<string, Schema> = {
    plain: textSchema,
    text: {
      fields: [
        { name: "transcript", type: "Text", format: "UTF-8", stream: false },
      ],
    },
    audio: {
      fields: [
        {
          name: "audio",
          type: "Audio",
          format: "WAV · 16kHz · Mono",
          stream: false,
        },
      ],
    },
    multi: {
      fields: [
        {
          name: "audio",
          type: "Audio",
          format: "WAV · 16kHz · Mono",
          stream: false,
        },
        { name: "image", type: "Image", format: "Image/*", stream: false },
      ],
    },
    reply: {
      fields: [{ name: "reply", type: "Text", format: "UTF-8", stream: false }],
    },
    answer: {
      fields: [
        { name: "reply", type: "Text", format: "UTF-8", stream: true },
        {
          name: "speech",
          type: "Audio",
          format: "WAV · 16kHz · Mono",
          stream: true,
        },
      ],
    },
  };
  const [versions, setVersions] = useState<Resource<Pipeline>>();
  const create = useWrite(() =>
    write<Resource<Pipeline>>(
      "/pipelines",
      newPipeline(
        name,
        startName,
        t.pipelines.end,
        presets[inputPreset],
        outputPreset === "same" ? presets[inputPreset] : presets[outputPreset],
      ),
    ),
  );
  if (selected.data)
    return <Designer key={selected.data.id} resource={selected.data} />;
  if (id)
    return (
      <RequestState
        error={selected.error}
        retry={() => {
          void selected.refetch();
        }}
        back={() => navigate("/pipelines")}
      />
    );
  return (
    <>
      <Head
        title={t.pipelines.collection}
        actions={
          <div className="testflow-row">
            <Action action="import-flow" onPress={() => setImporting(true)}>
              <Upload />
              {t.pipelines.importWorkflow}
            </Action>
            <Action primary action="new-flow" onPress={() => setCreating(true)}>
              <Plus />
              {t.pipelines.add}
            </Action>
          </div>
        }
      />
      <Failure error={query.error || selected.error} />
      <ImportWorkflow
        open={importing}
        onClose={() => setImporting(false)}
        onImported={(resource) => {
          setImporting(false);
          navigate(`/pipelines/${resource.id}`);
        }}
      />
      {params.get("module") && (
        <Notice>
          <div className="testflow-row testflow-between">
            <span>
              <strong>
                {pendingModule.data?.name} · v
                {pendingModule.data?.selected_version}
              </strong>{" "}
              · {t.modules.choosePipeline}
            </span>
            <Action
              size="sm"
              onPress={() => {
                const next = new URLSearchParams(params);
                next.delete("module");
                next.delete("module_version");
                setParams(next);
              }}
            >
              {t.common.cancel}
            </Action>
          </div>
        </Notice>
      )}
      <div className="testflow-grid-2">
        {query.data?.items.map((p) => (
          <ResourceCard
            className="testflow-pipeline-card"
            key={p.id}
            icon={<FlowIcon />}
            title={p.name}
            version={p.version}
            onVersion={() => setVersions(p)}
            summary={`${p.data.nodes.length} ${t.pipelines.nodes} · ${p.data.nodes.filter((n) => n.kind === "end").length} ${t.pipelines.outlets}${p.data.nodes.some((n) => n.runtime?.requires_sequential) ? " · " + t.pipelines.sequentialNote : ""}`}
            actions={
              <>
                <DeleteResource kind="pipelines" resource={p} />
                <div className="testflow-row">
                  <Action
                    size="sm"
                    action="open-flow"
                    onPress={() =>
                      navigate(
                        `/pipelines/${p.id}${params.get("module") ? "?" + new URLSearchParams({ module: params.get("module")!, ...(params.get("module_version") ? { module_version: params.get("module_version")! } : {}) }).toString() : ""}`,
                      )
                    }
                  >
                    {t.pipelines.openCanvas}
                    <ArrowRight />
                  </Action>
                </div>
              </>
            }
          >
            <div className="testflow-row testflow-wrap testflow-mt">
              <Chips schema={p.data.input_schema} />
              <ArrowRight />
              <Chips schema={p.data.output_schema} />
            </div>
          </ResourceCard>
        ))}
      </div>
      {query.data?.total === 0 && <Empty text={t.common.empty} />}{" "}
      <Pagination
        page={list.page}
        total={query.data?.total || 0}
        onChange={list.onPage}
      />
      {creating && (
        <Dialog
          title={t.pipelines.add}
          onClose={() => {
            if (!create.isPending) setCreating(false);
          }}
          footer={
            <>
              <Action
                isDisabled={create.isPending}
                onPress={() => setCreating(false)}
              >
                {t.common.cancel}
              </Action>
              <Action
                primary
                isPending={create.isPending}
                isDisabled={!name.trim() || !startName.trim()}
                onPress={() =>
                  create.mutate(undefined, {
                    onSuccess: (p) => {
                      setCreating(false);
                      setName("");
                      setStartName(t.pipelines.start);
                      setInputPreset("plain");
                      setOutputPreset("same");
                      navigate(
                        `/pipelines/${p.id}${params.get("module") ? "?" + new URLSearchParams({ module: params.get("module")!, ...(params.get("module_version") ? { module_version: params.get("module_version")! } : {}) }).toString() : ""}`,
                      );
                    },
                  })
                }
              >
                {t.common.create}
              </Action>
            </>
          }
        >
          <div className="testflow-stack">
            <Text label={t.common.name} value={name} onChange={setName} />
            <Text
              label={t.pipelines.startName}
              value={startName}
              onChange={setStartName}
            />
            <div className="testflow-grid-2">
              <Choice
                label={t.pipelines.initialInput}
                value={inputPreset}
                onChange={setInputPreset}
                options={[
                  { id: "plain", name: "text / Text" },
                  { id: "audio", name: "audio / Audio" },
                  { id: "multi", name: "audio + image" },
                  { id: "text", name: "transcript / Text" },
                ]}
              />
              <Choice
                label={t.pipelines.unifiedOutput}
                value={outputPreset}
                onChange={setOutputPreset}
                options={[
                  { id: "same", name: t.pipelines.sameAsInput },
                  { id: "answer", name: t.pipelines.replyAndSpeech },
                  { id: "reply", name: "reply / Text" },
                ]}
              />
            </div>
            <Notice>{t.pipelines.initialContractHint}</Notice>
            <Failure error={create.error} />
          </div>
        </Dialog>
      )}{" "}
      {versions && (
        <Versions
          kind="pipelines"
          resource={versions}
          onClose={() => setVersions(undefined)}
        />
      )}
    </>
  );
}
