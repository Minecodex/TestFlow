import { FileInput } from "../../shared/ui/file-input";
import { useListState } from "../../shared/ui/list-state";
import { Pagination } from "../../shared/ui";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowRight, AudioLines, Clock, Code2, Combine, Image, Sparkles, Upload } from "lucide-react";
import { useMessages } from "../../i18n";
import { operationKey, write } from "../../shared/api/client";
import {
  useOperation,
  useResource,
  useResources,
  useWrite,
} from "../../shared/api/hooks";
import type {
  Module,
  Resource,
  Runtime,
  Operation,
} from "../../shared/api/types";
import {
  Action,
  Badge,
  Chips,
  Dialog,
  Empty,
  Failure,
  Head,
  Json,
  Notice,
  Status,
} from "../../shared/ui";
import { Hide, OperationStatus, Versions } from "../../shared/ui/resources";
import { ModulePanel } from "../../shared/module-host/host";
import { RuntimeEditor } from "./runtime";
import { ModuleValidation } from "./validation";
import { AudioIcon, CodeIcon, HistoryIcon, ImageIcon, MergeIcon, SparkIcon } from "../../shared/icons";
function ModuleIcon({ module }: { module: Module }) {
  const Icon = module.manifest.runtime.requires_sequential ? HistoryIcon
    : module.inputs.fields.length > 1 ? MergeIcon
    : [...module.inputs.fields,...module.outputs.fields].some(f=>f.type==="Audio") ? AudioIcon
    : module.inputs.fields[0]?.type === "Image" ? ImageIcon : SparkIcon;
  return <Icon />;
}
function Detail({
  module,
  onClose,
}: {
  module: Resource<Module>;
  onClose: () => void;
}) {
  const t = useMessages();
  const navigate = useNavigate();
  const [runtime, setRuntime] = useState<Runtime>(module.data.manifest.runtime);
  return (
    <Dialog
      drawer
      title={`${module.name} · ${module.data.manifest.version}`}
      onClose={onClose}
      footer={
        <>
          <Action
            action="module-to-flow"
            primary
            onPress={() =>
              navigate(
                `/pipelines?module=${module.id}&module_version=${module.selected_version}`,
              )
            }
          >
            {t.modules.use}
          </Action>
          <Hide kind="modules" resource={module} />
        </>
      }
    >
      <div className="testflow-stack">
        <Badge>
          {module.data.manifest.runtime.requires_sequential
            ? t.modules.sequential
            : t.modules.parallel}
        </Badge>
        <h3>{t.common.inputSchema}</h3>
        <Chips schema={module.data.inputs} />
        <Json value={module.data.inputs} />
        <h3>{t.common.outputSchema}</h3>
        <Chips schema={module.data.outputs} />
        <h3>Kubernetes Pod</h3>
        <RuntimeEditor value={runtime} onChange={setRuntime} />
        <ModuleValidation
          key={module.revision_id}
          module={module}
          runtime={runtime}
        />
        <h3>{t.modules.readonly}</h3>
        <ModulePanel
          module={module}
          value={module.data.manifest.defaults || {}}
          onChange={() => {}}
          readonly
        />
        <h3>manifest.json</h3>
        <Json value={module.data.manifest} />
      </div>
    </Dialog>
  );
}
export function ModulesPage() {
  const t = useMessages();
  const { id } = useParams();
  const navigate = useNavigate();
  const list = useListState();
  const modules = useResources<Module>("modules", list.query);
  const selected = useResource<Module>("modules", id);
  const [importing, setImporting] = useState(false);
  const [importOperation, setImportOperation] = useState<string>();
  const [pendingModule, setPendingModule] = useState<string>();
  const imported = useOperation(importOperation);
  useEffect(() => {
    if (pendingModule && imported.data?.state === "succeeded") {
      navigate("/modules/" + pendingModule);
      setPendingModule(undefined);
    }
  }, [pendingModule, imported.data?.state, navigate]);
  const [file, setFile] = useState<File>();
  const [spec, setSpec] = useState(false);
  const [versions, setVersions] = useState<Resource<Module>>();
  const [key, setKey] = useState(operationKey);
  const upload = useWrite(() => {
    const form = new FormData();
    form.append("file", file!);
    return write<Resource<Module>>("/modules/import", form, "POST", key);
  });
  return (
    <>
      <Head
        title={t.modules.title}
        description={t.modules.description}
        eyebrow="CAPABILITIES / 03"
        actions={
          <Action
            primary
            action="import-module"
            onPress={() => {
              setKey(operationKey());
              setImporting(true);
            }}
          >
            <Upload />
            {t.modules.add}
          </Action>
        }
      />
      <div className="testflow-toolbar">
        <span className="testflow-row">
          <Badge state="ready">{modules.data?.items.filter(m=>m.availability?.state === "succeeded").length || 0} {t.modules.available}</Badge>
          <span className="testflow-small testflow-muted">{t.modules.contractSummary}</span>
        </span>
        <Action size="sm" variant="ghost" className="testflow-link" action="module-spec" onPress={() => setSpec(true)}>
          <CodeIcon />
          {t.modules.spec}
        </Action>
      </div>
      <Notice>{t.modules.protocolNote}</Notice>
      <Failure error={modules.error} />
      <OperationStatus id={importOperation} />
      <div className="testflow-grid-3 testflow-mt">
        {modules.data?.items.map((m) => (
          <article className="testflow-card testflow-module-card" key={m.id}>
            <div className="testflow-card-header">
              <div className="testflow-row">
                <span className="testflow-module-icon">
                  <ModuleIcon module={m.data} />
                </span>
                <div>
                  <h3>{m.name}</h3>
                  <span className="testflow-tiny testflow-muted testflow-mono">
                    {m.data.manifest.id} / {m.data.manifest.version}
                  </span>
                </div>
              </div>
              <Badge state={m.data.manifest.runtime.requires_sequential ? "sequential" : "ready"}>
                {m.data.manifest.runtime.requires_sequential
                  ? t.modules.cardSequential
                  : t.modules.parallel}
              </Badge>
            </div>
            <div className="testflow-row testflow-wrap testflow-module-runtime">
              <Badge state="ready">Kubernetes Pod</Badge>
              <Status value={m.availability?.state === "succeeded" ? "ready" : m.availability?.state || "pending"} />
            </div>
            <p className="testflow-module-description">
              {m.data.manifest.description}
            </p>
            <div className="testflow-module-line">
              <Chips schema={m.data.inputs} />
              <ArrowRight />
              <Chips schema={m.data.outputs} />
            </div>
            <div className="testflow-module-footer">
              <span className="testflow-tiny testflow-muted"><CodeIcon /> {t.modules.standardContract}</span>
              <span className={`testflow-tiny ${m.data.manifest.exposes_trace ? "testflow-text-green" : "testflow-muted"}`}>
                {m.data.manifest.exposes_trace
                  ? t.modules.trace
                  : t.modules.boundary}
              </span>
            </div>
            <div className="testflow-row testflow-between testflow-mt">
              <Action size="sm" variant="ghost" className="testflow-link" aria-label={t.common.versions} onPress={() => setVersions(m)}>
                <span className="testflow-tag">{m.data.manifest.ui.split("/").at(-1)}</span>
              </Action>
              <Action
                size="sm"
                variant="ghost"
                action="module-detail"
                onPress={() => navigate(`/modules/${m.id}`)}
              >
                {t.modules.contract}
                <ArrowRight />
              </Action>
            </div>
          </article>
        ))}
      </div>
      {modules.data?.total === 0 && <Empty text={t.common.empty} />}
      {selected.data && (
        <Detail
          key={selected.data.revision_id}
          module={selected.data}
          onClose={() => navigate("/modules")}
        />
      )}
      {versions && (
        <Versions
          kind="modules"
          resource={versions}
          onClose={() => setVersions(undefined)}
        />
      )}
      <Pagination
        page={list.page}
        total={modules.data?.total || 0}
        onChange={list.onPage}
      />
      {importing && (
        <Dialog
          title={t.modules.add}
          onClose={() => {
            if (!upload.isPending) setImporting(false);
          }}
          footer={
            <>
              <Action
                onPress={() => setImporting(false)}
                isDisabled={upload.isPending}
              >
                {t.common.cancel}
              </Action>
              <Action
                primary
                isPending={upload.isPending}
                isDisabled={!file}
                onPress={() =>
                  upload.mutate(undefined, {
                    onSuccess: (m) => {
                      setImportOperation(m.operation_id || undefined);
                      setPendingModule(m.operation_id ? m.id : undefined);
                      setImporting(false);
                      setFile(undefined);
                      if (!m.operation_id) navigate("/modules/" + m.id);
                    },
                  })
                }
              >
                {t.modules.add}
              </Action>
            </>
          }
        >
          <div className="testflow-stack">
            <FileInput
              label={t.modules.selectZip}
              accept=".zip"
              onChange={(files) => {
                setFile(files[0]);
                setKey(operationKey());
              }}
            />
            {file && <Notice>{file.name}</Notice>}
            <Failure error={upload.error} />
            <Notice>{t.modules.note}</Notice>
          </div>
        </Dialog>
      )}
      {spec && (
        <Dialog title={t.modules.spec} onClose={() => setSpec(false)}>
          <pre className="testflow-json">
            {
              "module.zip\n  manifest.json\n  schemas/inputs.json\n  schemas/outputs.json\n  schemas/parameters.json\n  ui/config-panel.js\n  README.md"
            }
          </pre>
          <Notice>
            testflow.module.v1 · testflow.ui.v1 · HTTP / WebSocket
          </Notice>
        </Dialog>
      )}
    </>
  );
}
