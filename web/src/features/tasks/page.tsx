import { useCompactDateTime } from "../../shared/ui/date-time";
import { useListState } from "../../shared/ui/list-state";
import { Pagination } from "../../shared/ui";
import { useResourceOptions } from "../../shared/api/hooks";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { detailHref, safeReturn } from "../../shared/ui/navigation";
import { ArrowRight, Clock, Database, ListChecks, Plus, Trash2, Workflow } from "lucide-react";
import { useMessages } from "../../i18n";
import { getJson, operationKey, write } from "../../shared/api/client";
import { useResource, useResources, useWrite } from "../../shared/api/hooks";
import type {
  Dataset,
  Dimension,
  Page,
  Pipeline,
  Profile,
  Report,
  Resource,
  Task,
  TaskBody,
  Overview,
} from "../../shared/api/types";
import {
  Action,
  Badge,
  Choice,
  DataTable,
  Dialog,
  Empty,
  Failure,
  Head,
  Notice,
  Panel,
  Status,
  Text,
  download,
} from "../../shared/ui";
import { Hide } from "../../shared/ui/resources";
import { PinnedChoice } from "../../shared/ui/pinned-choice";
import { PlanBindings, type BindingOverrides } from "../evaluation/bindings";
import { RequestState } from "../../shared/ui/request-state";
import { DatabaseIcon, FlowIcon, HistoryIcon, TaskIcon } from "../../shared/icons";
function PairFields({
  pair,
  onChange,
  datasets,
  pipelines,
  profile,
}: {
  pair: TaskBody["pairs"][number];
  onChange: (p: TaskBody["pairs"][number]) => void;
  datasets: Resource<Dataset>[];
  pipelines: Resource<Pipeline>[];
  profile?: Resource<Profile>;
}) {
  const t = useMessages();
  const pipeline = useResource<Pipeline>(
    "pipelines",
    pair.pipeline_id,
    String(pair.pipeline_version),
  );
  const dataset = useResource<Dataset>(
    "datasets",
    pair.dataset_id,
    String(pair.dataset_version),
  );
  return (
    <div className="testflow-stack">
      <div className="testflow-grid-2">
        <PinnedChoice
          label={t.tasks.dataset}
          kind="datasets"
          resources={datasets}
          id={pair.dataset_id}
          version={pair.dataset_version}
          onChange={(dataset_id, dataset_version) =>
            onChange({ ...pair, dataset_id, dataset_version })
          }
        />
        <PinnedChoice
          label={t.tasks.pipeline}
          kind="pipelines"
          resources={pipelines}
          id={pair.pipeline_id}
          version={pair.pipeline_version}
          onChange={(pipeline_id, pipeline_version) =>
            onChange({ ...pair, pipeline_id, pipeline_version })
          }
        />
      </div>
      <Text
        label={t.tasks.repetitions}
        value={pair.repetitions ?? 1}
        type="number"
        onChange={(v) => onChange({ ...pair, repetitions: Number(v) })}
      />
      {profile && pipeline.data && (
        <PlanBindings
          profile={profile.data}
          pipeline={pipeline.data.data}
          referenceSchema={dataset.data?.data.output_schema}
          value={(pair.bindings || {}) as BindingOverrides}
          onChange={(bindings) => onChange({ ...pair, bindings })}
        />
      )}
      <Failure error={pipeline.error || dataset.error} />
    </div>
  );
}
function CreateTask({ onClose }: { onClose: () => void }) {
  const t = useMessages();
  const navigate = useNavigate();
  const datasets = useResourceOptions<Dataset>("datasets");
  const pipelines = useResourceOptions<Pipeline>("pipelines");
  const profiles = useResourceOptions<Profile>("evaluation-profiles");
  const draftKey = "testflow.task-draft";
  const [restored] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(draftKey) || "null") as {
        body: TaskBody;
        key: string;
      } | null;
    } catch {
      return null;
    }
  });
  const [body, setBody] = useState<TaskBody>(
    restored?.body || {
      name: "",
      pairs: [
        {
          dataset_id: "",
          dataset_version: 1,
          pipeline_id: "",
          pipeline_version: 1,
          repetitions: 1,
          bindings: {},
        },
      ],
      profile_id: "",
      profile_version: 1,
      concurrency: 1,
    },
  );
  const [key, setKey] = useState(restored?.key || operationKey());
  useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify({ body, key }));
    } catch {}
  }, [body, key]);
  const [previewSignature, setPreviewSignature] = useState("");
  const patch = (v: Partial<TaskBody>) => {
    setBody({ ...body, ...v });
    setKey(operationKey());
  };
  const profile = useResource<Profile>(
    "evaluation-profiles",
    body.profile_id,
    String(body.profile_version),
  );
  const preview = useWrite(() =>
    write<{
      plan_count: number;
      effective_concurrency: number;
      restrictions: { name: string }[];
      items: {
        name: string;
        dataset: string;
        pipeline: string;
        repetition: number;
      }[];
    }>("/tasks/preview", body),
  );
  const create = useWrite(() => write<Task>("/tasks", body, "POST", key));
  const ready = previewSignature === JSON.stringify(body) && !!preview.data;
  return (
    <Dialog
      title={t.tasks.add}
      wide
      onClose={() => {
        if (!create.isPending) onClose();
      }}
      footer={
        <>
          <Action isDisabled={create.isPending} onPress={onClose}>
            {t.common.cancel}
          </Action>
          <Action
            isPending={preview.isPending}
            onPress={() =>
              preview.mutate(undefined, {
                onSuccess: () => setPreviewSignature(JSON.stringify(body)),
              })
            }
          >
            {t.tasks.preview}
          </Action>
          <Action
            primary
            isDisabled={!ready}
            isPending={create.isPending}
            onPress={() =>
              create.mutate(undefined, {
                onSuccess: (task) => {
                  localStorage.removeItem(draftKey);
                  onClose();
                  navigate("/test-tasks/" + task.id);
                },
              })
            }
          >
            {t.tasks.add}
          </Action>
        </>
      }
    >
      <div className="testflow-stack">
        <Failure
          error={
            preview.error ||
            create.error ||
            datasets.error ||
            pipelines.error ||
            profiles.error
          }
        />
        <Text
          label={t.common.name}
          value={body.name}
          onChange={(name) => patch({ name })}
        />
        <PinnedChoice
          label={t.evaluation.title}
          kind="evaluation-profiles"
          resources={profiles.data?.items || []}
          id={body.profile_id}
          version={body.profile_version}
          onChange={(profile_id, profile_version) =>
            patch({ profile_id, profile_version })
          }
        />
        <Text
          label={t.tasks.concurrency}
          type="number"
          value={body.concurrency ?? 1}
          onChange={(v) => patch({ concurrency: Number(v) })}
        />
        <h3>{t.tasks.pairs}</h3>
        {body.pairs.map((pair, i) => (
          <div className="testflow-outline testflow-stack" key={i}>
            <div className="testflow-row testflow-between">
              <Badge>{i + 1}</Badge>
              <Action
                action="remove-pair"
                isIconOnly
                aria-label={t.common.remove}
                isDisabled={body.pairs.length === 1}
                onPress={() =>
                  patch({ pairs: body.pairs.filter((_, n) => n !== i) })
                }
              >
                <Trash2 />
              </Action>
            </div>
            <PairFields
              pair={pair}
              datasets={datasets.data?.items || []}
              pipelines={pipelines.data?.items || []}
              profile={profile.data}
              onChange={(value) =>
                patch({
                  pairs: body.pairs.map((p, n) => (n === i ? value : p)),
                })
              }
            />
          </div>
        ))}
        <Action
          action="add-pair"
          onPress={() =>
            patch({
              pairs: [
                ...body.pairs,
                {
                  dataset_id: "",
                  dataset_version: 1,
                  pipeline_id: "",
                  pipeline_version: 1,
                  repetitions: 1,
                  bindings: {},
                },
              ],
            })
          }
        >
          <Plus />
          {t.tasks.addPair}
        </Action>
        {preview.data && ready && (
          <>
            <Notice>
              {preview.data.plan_count} {t.tasks.plan} · {t.tasks.requested}{" "}
              {body.concurrency} / {t.tasks.effective}{" "}
              {preview.data.effective_concurrency}
              {preview.data.restrictions.map((n) => (
                <div key={n.name}>
                  {n.name} · {t.modules.sequential}
                </div>
              ))}
            </Notice>
            <DataTable
              label={t.tasks.plan}
              headers={[
                t.common.name,
                t.tasks.dataset,
                t.tasks.pipeline,
                t.tasks.repetitions,
              ]}
              rows={preview.data.items.map((item, i) => ({
                id: String(i),
                cells: [
                  item.name,
                  item.dataset,
                  item.pipeline,
                  item.repetition,
                ],
              }))}
            />
          </>
        )}
      </div>
    </Dialog>
  );
}
export function ReportView({ report }: { report: Report }) {
  const t = useMessages();
  const navigate = useNavigate();
  const location = useLocation();
  const pct = (value: number | null) =>
    value === null ? "—" : (value * 100).toFixed(1) + "%";
  return (
    <>
      <div className="testflow-report-summary">
        {[
          {
            label: t.tasks.runProgress,
            value: `${report.run_completed} / ${report.plan_count}`,
          },
          {
            label: t.tasks.scoreProgress,
            value: `${report.evaluated} / ${report.plan_count}`,
          },
          {
            label: t.tasks.referenceRate,
            value: pct(report.reference.pass_rate),
            rate: report.reference,
          },
          {
            label: t.tasks.qualityRate,
            value: pct(report.quality.pass_rate),
            rate: report.quality,
          },
        ].map((stat) => (
          <div className="testflow-stat" key={stat.label}>
            <div className="testflow-muted testflow-small">{stat.label}</div>
            <div className="testflow-stat-value">{stat.value}</div>
            {stat.rate && (
              <small>
                {t.tasks.coverage} {pct(stat.rate.coverage)} · {stat.rate.valid}{" "}
                / {stat.rate.expected}
              </small>
            )}
          </div>
        ))}
      </div>
      <Panel>
        <DataTable
          label={t.tasks.current}
          headers={[
            t.datasets.cases,
            t.tasks.pipeline,
            t.common.status,
            t.evaluation.title,
            t.executions.cleanup,
            t.common.actions,
          ]}
          rows={report.rows.map((row) => ({
            id: row.item_id,
            cells: [
              <div>
                <strong>{row.case.name}</strong>
                <div className="testflow-muted">
                  {row.dataset.name} · {row.repetition}
                </div>
              </div>,
              `${row.pipeline.name} v${row.pipeline.version}`,
              <div className="testflow-stack">
                <Status value={row.execution_state} />
                {row.active_execution_id && (
                  <Badge state="running">{t.common.states.running}</Badge>
                )}
              </div>,
              <Status value={row.verdict} />,
              <Status value={row.cleanup} />,
              <div className="testflow-row">
                <Action
                  size="sm"
                  action="execution-detail"
                  isDisabled={!row.execution_id && !row.active_execution_id}
                  onPress={() =>
                    navigate(
                      detailHref(
                        "/executions/" +
                          (row.execution_id || row.active_execution_id),
                        location.pathname + location.search,
                        row.execution_id && row.evaluation_id
                          ? { evaluation: row.evaluation_id }
                          : {},
                      ),
                    )
                  }
                >
                  {t.common.details}
                </Action>
                {row.active_execution_id && row.execution_id && (
                  <Action
                    size="sm"
                    onPress={() =>
                      navigate(
                        detailHref(
                          "/executions/" + row.active_execution_id,
                          location.pathname + location.search,
                        ),
                      )
                    }
                  >
                    {t.executions.activeAttempt}
                  </Action>
                )}
              </div>,
            ],
          }))}
        />
      </Panel>
    </>
  );
}
function TaskDetail({ task }: { task: Task }) {
  const t = useMessages();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const reports = useQuery({
    queryKey: ["reports", task.id],
    queryFn: () =>
      getJson<{
        current: Report;
        items: { id: string; snapshot: Report; created: string }[];
      }>(`/tasks/${task.id}/reports`),
  });
  const chosen = params.get("report") || "__current";
  const setChosen = (value: string) => {
    const next = new URLSearchParams(params);
    next.set("report", value);
    setParams(next);
  };
  const report =
    chosen === "__current"
      ? reports.data?.current
      : reports.data?.items.find((r) => r.id === chosen)?.snapshot;
  const cancel = useWrite(() => write(`/tasks/${task.id}/cancel`));
  const [compare, setCompare] = useState(false);
  const groups = new Map<string, Report["rows"]>();
  for (const row of report?.rows || []) {
    const key = row.sample_identity + ":" + row.repetition;
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  const common = [...groups.values()].filter(
    (rows) => new Set(rows.map((r) => r.pair_id)).size > 1,
  );
  return (
    <>
      <Head
        title={task.name}
        description={new Date(task.created).toLocaleString()}
        actions={
          <>
            <Action
              action="task-back"
              onPress={() =>
                navigate(safeReturn(params.get("return"), "/test-tasks"))
              }
            >
              {t.common.back}
            </Action>
            <Hide kind="tasks" resource={task} />
            <Action
              action="task-history"
              onPress={() =>
                navigate(
                  detailHref(
                    "/executions",
                    location.pathname + location.search,
                    { task_id: task.id },
                  ),
                )
              }
            >
              {t.tasks.history}
            </Action>
            <Action
              danger
              action="cancel-task"
              isDisabled={!["queued", "running"].includes(task.state)}
              isPending={cancel.isPending}
              onPress={() => cancel.mutate(undefined)}
            >
              {t.tasks.cancel}
            </Action>
          </>
        }
      />
      <div className="testflow-toolbar">
        <div className="testflow-row">
          <Status value={task.state} />
          <Badge>
            {t.tasks.requested} {task.requested_concurrency} /{" "}
            {t.tasks.effective} {task.effective_concurrency}
          </Badge>
        </div>
        <Choice
          label={t.tasks.reports}
          value={chosen}
          onChange={setChosen}
          options={[
            { id: "__current", name: t.tasks.current },
            ...(reports.data?.items || []).map((r, i) => ({
              id: r.id,
              name: `#${i + 1} · ${new Date(r.created).toLocaleString()}`,
            })),
          ]}
        />
        <Action onPress={() => setCompare(true)}>{t.tasks.compare}</Action>
        <Action
          action="export-report"
          onPress={() => download(`${task.name}-report.json`, report)}
        >
          {t.common.export}
        </Action>
      </div>
      <Failure error={reports.error || cancel.error} />
      {report && <ReportView report={report} />}{" "}
      {compare && (
        <Dialog title={t.tasks.compare} wide onClose={() => setCompare(false)}>
          {common.length ? (
            common.map((rows, i) => (
              <div className="testflow-stack testflow-mb" key={i}>
                <h3>{rows[0].case.name}</h3>
                <DataTable
                  label={t.tasks.compare}
                  headers={[
                    t.tasks.pipeline,
                    t.common.status,
                    t.evaluation.title,
                    t.common.duration,
                  ]}
                  rows={rows.map((r) => ({
                    id: r.item_id,
                    cells: [
                      `${r.pipeline.name} v${r.pipeline.version}`,
                      <Status value={r.execution_state} />,
                      <Status value={r.verdict} />,
                      (r.duration_ms == null ? "—" : r.duration_ms.toFixed(1)) +
                        " ms",
                    ],
                  }))}
                />
              </div>
            ))
          ) : (
            <Empty text={t.common.empty} />
          )}
        </Dialog>
      )}
    </>
  );
}
export function TasksPage() {
  const compactDateTime = useCompactDateTime();
  const t = useMessages();
  const statistics = useQuery({ queryKey:["overview"], queryFn:()=>getJson<Overview>("/system/overview") });
  const { id } = useParams();
  const list = useListState();
  const query = useQuery({
    queryKey: ["tasks", list.query],
    queryFn: () => getJson<Page<Task>>("/tasks?" + list.query),
  });
  const selected = useQuery({
    queryKey: ["task", id],
    queryFn: () => getJson<Task>("/tasks/" + id),
    enabled: !!id,
  });
  const navigate = useNavigate();
  const [routeParams, setRouteParams] = useSearchParams();
  const [creating, setCreating] = useState(routeParams.get("create") === "1");
  if (selected.data) return <TaskDetail task={selected.data} />;
  if (id)
    return (
      <RequestState
        error={selected.error}
        retry={() => {
          void selected.refetch();
        }}
        back={() => navigate("/test-tasks")}
      />
    );
  return (
    <>
      <Head
        title={t.tasks.title}
        description={t.tasks.description}
        eyebrow="RUNS / 08"
        actions={
          <Action primary action="new-task" onPress={() => setCreating(true)}>
            <Plus />
            {t.tasks.add}
          </Action>
        }
      />
      <div className="testflow-grid-4 testflow-mb">
        {[
          {name:t.tasks.taskCount,value:statistics.data?.counts.tasks,note:t.tasks.pairNote,icon:TaskIcon},
          {name:t.tasks.plannedCases,value:statistics.data?.counts.planned_cases,note:t.tasks.planNote,icon:DatabaseIcon},
          {name:t.tasks.attemptCount,value:statistics.data?.counts.executions,note:t.tasks.attemptNote,icon:HistoryIcon},
          {name:t.tasks.runningCases,value:statistics.data ? statistics.data.runs.running || 0 : undefined,note:t.tasks.concurrencyNote,icon:FlowIcon},
        ].map(s=><div className="testflow-stat" key={s.name}>
          <div className="testflow-row testflow-between"><span className="testflow-stat-label">{s.name}</span><span className="testflow-stat-icon"><s.icon /></span></div>
          <div className="testflow-stat-value">{s.value ?? "—"}</div><div className="testflow-stat-note">{s.note}</div>
        </div>)}
      </div>
      <Failure error={query.error || selected.error} />
      <Panel>
        {query.data?.items.length ? (
          <DataTable
            label={t.tasks.title}
            headers={[
              t.overview.taskBatch,
              t.tasks.pair,
              t.tasks.runProgress,
              t.common.status,
              t.common.created,
              "",
            ]}
            rows={query.data.items.map((task) => ({
              id: task.id,
              cells: [
                <div><Action variant="ghost" className="testflow-link testflow-cell-title" onPress={()=>navigate("/test-tasks/"+task.id)}>{task.name}</Action><div className="testflow-row-subtitle testflow-muted testflow-mono">{task.id.slice(0,16)}</div></div>,
                `${task.snapshot.pairs?.length || 0} ${t.tasks.pairUnit}`,
                <div className="testflow-progress-cell"><div className="testflow-row testflow-between"><span>{task.report.run_completed} / {task.report.plan_count}</span><span className="testflow-muted">{Math.round(task.report.run_completed/(task.report.plan_count || 1)*100)}%</span></div><div className="testflow-progress"><span style={{width:`${task.report.run_completed/(task.report.plan_count||1)*100}%`}} /></div></div>,
                <Status value={task.state} />,
                <span className="testflow-small testflow-muted testflow-mono">{compactDateTime(task.created)}</span>,
                <div className="testflow-row-actions">
                  <Action
                    size="sm"
                    variant="ghost"
                    action="task-detail"
                    aria-label={t.tasks.reportLabel}
                    onPress={() => navigate("/test-tasks/" + task.id)}
                  >
                    {t.tasks.reportLabel}<ArrowRight />
                  </Action>
                </div>,
              ],
            }))}
          />
        ) : (
          !query.isPending && <Empty text={t.common.empty} />
        )}
      </Panel>
      <div className="testflow-mt"><Notice>{t.tasks.sequentialNote}</Notice></div>
      <Pagination
        page={list.page}
        total={query.data?.total || 0}
        onChange={list.onPage}
      />
      {creating && (
        <CreateTask
          onClose={() => {
            setCreating(false);
            const next = new URLSearchParams(routeParams);
            next.delete("create");
            setRouteParams(next);
          }}
        />
      )}
    </>
  );
}
