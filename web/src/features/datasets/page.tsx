import { DeleteAction, EditAction } from "../../shared/ui";
import { useListState } from "../../shared/ui/list-state";
import {Pagination} from "../../shared/ui";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowRight, Database, History, Plus } from "lucide-react";
import { useMessages } from "../../i18n";
import { ApiError, write } from "../../shared/api/client";
import {
  useResource,
  useResources,
  useWrite,
  useResourceOptions,
} from "../../shared/api/hooks";
import type { Asset, Case, Dataset, Resource } from "../../shared/api/types";
import { textSchema } from "../../shared/api/types";
import {Action, Badge, Chips, DataTable, Dialog, Empty, Failure, Head, Json, Notice, Panel, SchemaEditor, Text} from "../../shared/ui";
import { DeleteResource, Versions } from "../../shared/ui/resources";
import { CaseEditor } from "./case-editor";
import { InputGroups } from "./materials";
import { CaseSession } from "./case-session";
import { schemaIssues } from "../../shared/schema/validation";
import { DraftConflict, restoreDraft } from "../../shared/ui/draft-conflict";
import { RequestState } from "../../shared/ui/request-state";
import { ResourceCard } from "../../shared/ui/resource-card";
import { DatabaseIcon } from "../../shared/icons";
import { DatasetExport, ImportDataset } from "./transfer";
function Wizard({
  initial,
  onClose,
}: {
  initial?: Resource<Dataset>;
  onClose: () => void;
}) {
  const t = useMessages();
  const key = "testflow.dataset-draft.v2." + (initial?.id || "new");
  const [restored] = useState(() =>
    restoreDraft(
      key,
      initial?.version || 0,
      initial?.data || {
        name: "",
        description: "",
        input_schema: structuredClone(textSchema),
        cases: [],
      },
    ),
  );
  const [baseVersion, setBaseVersion] = useState(restored.baseVersion);
  const [data, setData] = useState<Dataset>(restored.data);
  const [step, setStep] = useState(0);
  const [caseDraft, setCaseDraft] = useState<Case | null | undefined>();
  const [bulk, setBulk] = useState(false);
  const assets = useResourceOptions<Asset>("assets");
  const patch = (v: Partial<Dataset>) => setData({ ...data, ...v });
  useEffect(() => {
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ base_version: baseVersion, data }),
      );
    } catch {}
  }, [key, data, baseVersion]);
  const save = useWrite(() =>
    write(
      initial ? `/datasets/${initial.id}` : "/datasets",
      initial ? { expected_version: baseVersion, data } : data,
      initial ? "PUT" : "POST",
    ),
  );
  const conflict =
    !!initial &&
    (initial.version > baseVersion ||
      (save.error instanceof ApiError && save.error.status === 409));
  const cases = data.cases || [];
  const upsert = (value: Case) => {
    patch({
      cases: cases.some((c) => c.id === value.id)
        ? cases.map((c) => (c.id === value.id ? value : c))
        : [...cases, value],
    });
    setCaseDraft(undefined);
  };
  const addBulk = (asset: Resource<Asset>) => {
    if (data.input_schema.fields.length !== 1) return;
    const field = data.input_schema.fields[0];
    const binding = { asset_id: asset.id, asset_version: null };
    if (
      cases.some(
        (c) => c.inputs[field.name]?.asset_id === asset.id,
      )
    )
      return;
    patch({
      cases: [
        ...cases,
        {
          id: crypto.randomUUID(),
          name: asset.name,
          inputs: { [field.name]: binding },
        },
      ],
    });
  };
  return (
    <>
      <Dialog
        title={t.datasets.wizard}
        wide
        onClose={onClose}
        footer={
          <>
            <Action
              action="dataset-prev"
              isDisabled={!step}
              onPress={() => setStep(step - 1)}
            >
              {t.common.previous}
            </Action>
            <Action onPress={onClose}>{t.common.cancel}</Action>
            {step < 2 ? (
              <Action
                primary
                action="dataset-next"
                isDisabled={
                  !data.name ||
                  schemaIssues(data.input_schema).length > 0
                }
                onPress={() => setStep(step + 1)}
              >
                {t.common.next}
              </Action>
            ) : (
              <Action
                primary
                action="dataset-create"
                isDisabled={
                  conflict ||
                  !data.name ||
                  schemaIssues(data.input_schema).length > 0
                }
                isPending={save.isPending}
                onPress={() =>
                  save.mutate(undefined, {
                    onSuccess: () => {
                      localStorage.removeItem(key);
                      onClose();
                    },
                  })
                }
              >
                {t.common.save}
              </Action>
            )}
          </>
        }
      >
        <div className="testflow-stack">
          <div className="testflow-stepper">
            {[t.datasets.structure, t.datasets.members, t.datasets.review].map(
              (label, i) => (
                <Badge key={label} state={step === i ? "ready" : "pending"}>
                  {i + 1} · {label}
                </Badge>
              ),
            )}
          </div>
          <Failure error={save.error} />
          {conflict && initial && (
            <DraftConflict
              kind="datasets"
              id={initial.id}
              draft={data}
              onContinue={(latest) => {
                setBaseVersion(latest.version);
                save.reset();
              }}
            />
          )}
          {step === 0 ? (
            <>
              <Text
                label={t.common.name}
                value={data.name}
                onChange={(name) => patch({ name })}
              />
              <Text
                label={t.common.description}
                value={data.description || ""}
                multiline
                onChange={(description) => patch({ description })}
              />
              <h3>{t.common.inputSchema}</h3>
              <SchemaEditor
                value={data.input_schema}
                onChange={(input_schema) => patch({ input_schema })}
                stream={false}
              />

            </>
          ) : step === 1 ? (
            <>
              <div className="testflow-row">
                <Action
                  action="draft-add-case"
                  onPress={() => setCaseDraft(null)}
                >
                  <Plus />
                  {t.datasets.addCase}
                </Action>
                <Action
                  action="dataset-batch-add"
                  isDisabled={data.input_schema.fields.length !== 1}
                  onPress={() => setBulk(true)}
                >
                  {t.datasets.batch}
                </Action>
              </div>
              {cases.map((c) => (
                <div
                  className="testflow-row testflow-between testflow-outline"
                  key={c.id}
                >
                  <span>{c.name}</span>
                  <div className="testflow-row">
                    <EditAction
                      action="draft-edit-case"
                      size="sm"
                      onPress={() => setCaseDraft(c)}
                    >
                      {t.common.edit}
                    </EditAction>
                    <DeleteAction
                      action="draft-remove-case"
                      size="sm"
                      danger
                      onPress={() =>
                        patch({ cases: cases.filter((v) => v.id !== c.id) })
                      }
                    >
                      {t.common.remove}
                    </DeleteAction>
                  </div>
                </div>
              ))}
              {!cases.length && <Empty text={t.datasets.noCases} />}
              <Notice>{t.datasets.dedup}</Notice>
            </>
          ) : (
            <>
              <h3>{data.name}</h3>
              <Chips schema={data.input_schema} />
              <Badge>
                {cases.length} {t.datasets.cases}
              </Badge>
              <Json value={data} />
            </>
          )}
        </div>
      </Dialog>
      {caseDraft !== undefined && (
        <CaseEditor
          key={caseDraft?.id || "new"}
          initial={caseDraft || undefined}
          schema={data.input_schema}
          onClose={() => setCaseDraft(undefined)}
          onSave={upsert}
        />
      )}{" "}
      {bulk && (
        <Dialog title={t.datasets.batch} onClose={() => setBulk(false)}>
          <div className="testflow-stack">
            <Failure error={assets.error} />
            {assets.data?.items
              .filter(
                (a) =>
                  a.data.type === data.input_schema.fields[0].type &&
                  a.data.format === data.input_schema.fields[0].format,
              )
              .map((a) => (
                <Action
                  key={a.id}
                  isDisabled={cases.some(
                    (c) =>
                      c.inputs[data.input_schema.fields[0].name]?.asset_id === a.id,
                  )}
                  onPress={() => addBulk(a)}
                >
                  {a.name} · v{a.version}
                </Action>
              ))}
          </div>
        </Dialog>
      )}
    </>
  );
}
export function DatasetsPage() {
  const t = useMessages();
  const navigate = useNavigate();
  const { id } = useParams();
  const list = useListState();
  const query = useResources<Dataset>("datasets", list.query);
  const selected = useResource<Dataset>("datasets", id);
  const [editing, setEditing] = useState<
    Resource<Dataset> | null | undefined
  >();
  const [caseDraft, setCaseDraft] = useState<Case | null | undefined>();
  const [versions, setVersions] = useState<Resource<Dataset>>();
  const [importing, setImporting] = useState(false);
  const change = useWrite((data: Dataset) =>
    write(
      `/datasets/${selected.data!.id}`,
      { expected_version: selected.data!.version, data },
      "PUT",
    ),
  );
  if (selected.data) {
    const dataset = selected.data;
    return (
      <>
        <Head
          title={dataset.name}
          meta={`v${dataset.selected_version} · ${dataset.data.description || ""}`}
          actions={
            <>
              <Action
                action="dataset-back"
                onPress={() => navigate("/datasets")}
              >
                {t.common.back}
              </Action>
              <EditAction action="edit-dataset" onPress={() => setEditing(dataset)}>
                {t.common.edit}
              </EditAction>
              <DatasetExport resource={dataset} />
              <Action
                action="add-case"
                primary
                onPress={() => setCaseDraft(null)}
              >
                <Plus />
                {t.datasets.addCase}
              </Action>
            </>
          }
        />
        <Panel title={t.common.inputSchema}>
          <Chips schema={dataset.data.input_schema} />
        </Panel>
        <div className="testflow-mt">
          <Failure error={change.error} />
          <Panel
            title={`${t.datasets.cases} · ${dataset.data.cases?.length || 0}`}
          >
            <InputGroups cases={(dataset.data.cases || []).slice((list.page - 1) * 30, list.page * 30)} schema={dataset.data.input_schema}
              onEdit={setCaseDraft} pending={change.isPending} onRemove={value => change.mutate({...dataset.data, cases: dataset.data.cases!.filter(c => c.id !== value.id)})} />
          </Panel>
        </div>
        {caseDraft !== undefined && (
          <CaseSession
            key={caseDraft?.id || "new"}
            initial={caseDraft || undefined}
            dataset={dataset}
            onClose={() => setCaseDraft(undefined)}
          />
        )}{" "}
        <Pagination
          page={list.page}
          total={dataset.data.cases?.length || 0}
          onChange={list.onPage}
        />
        {editing !== undefined && (
          <Wizard
            initial={editing || undefined}
            onClose={() => setEditing(undefined)}
          />
        )}
      </>
    );
  }
  if (id)
    return (
      <RequestState
        error={selected.error}
        retry={() => {
          void selected.refetch();
        }}
        back={() => navigate("/datasets")}
      />
    );
  return (
    <>
      <Head
        title={t.datasets.title}
        actions={
          <>
            <Action action="import-dataset" onPress={() => setImporting(true)}>
              {t.datasets.import}
            </Action>
            <Action
              primary
              action="new-dataset"
              onPress={() => setEditing(null)}
            >
              <Plus />
              {t.datasets.add}
            </Action>
          </>
        }
      />
      <Failure error={query.error || selected.error} />
      <ImportDataset
        open={importing}
        onClose={() => setImporting(false)}
        onImported={(resource) => {
          setImporting(false);
          navigate("/datasets/" + resource.id);
        }}
      />
      <div className="testflow-grid-3">
        {query.data?.items.map((d) => (
          <ResourceCard
            key={d.id}
            icon={<DatabaseIcon />}
            title={d.name}
            version={d.version}
            onVersion={() => setVersions(d)}
            summary={`${d.data.cases?.length || 0} ${t.datasets.cardCases}`}
            actions={
              <>
                <DeleteResource kind="datasets" resource={d} />
                <div className="testflow-row">
                  <Action
                    size="sm"
                    action="dataset-detail"
                    onPress={() => navigate("/datasets/" + d.id)}
                  >
                    {t.datasets.open}
                    <ArrowRight />
                  </Action>
                </div>
              </>
            }
          >
            <div className="testflow-schema-section">
              <div className="testflow-eyebrow">{t.common.inputSchema}</div>
              <Chips schema={d.data.input_schema} />
            </div>
          </ResourceCard>
        ))}
      </div>
      <div className="testflow-mt">
        <Notice>{t.datasets.schemaNote}</Notice>
      </div>
      {query.data?.total === 0 && <Empty text={t.common.empty} />}{" "}
      {editing !== undefined && (
        <Wizard
          initial={editing || undefined}
          onClose={() => setEditing(undefined)}
        />
      )}{" "}
      {versions && (
        <Versions
          kind="datasets"
          resource={versions}
          onClose={() => setVersions(undefined)}
        />
      )}
    </>
  );
}
