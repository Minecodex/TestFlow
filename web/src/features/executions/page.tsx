import { useCompactDateTime } from "../../shared/ui/date-time";
import { TraceTimeline } from "./trace";
import { ExecutionMediaPreview, executionPreview } from "./preview";
import { ExecutionMaterials, ExecutionSummary } from "./materials";
import { JudgeIcon } from "../../shared/icons";
import { useResourceOptions } from "../../shared/api/hooks";
import { Tabs } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowRight, Download, RefreshCw, RotateCcw } from "lucide-react";
import { useMessages } from "../../i18n";
import { getJson, operationKey, write } from "../../shared/api/client";
import { useResources, useWrite } from "../../shared/api/hooks";
import type {
  Dataset,
  Event,
  Execution,
  Module,
  Page,
  Pipeline,
  Profile,
  Resource,
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
  Json,
  Notice,
  Pagination,
  Panel,
  Status,
  Text,
  download,
} from "../../shared/ui";
import { LiveInput } from "./live-input";
import { ModulePanel } from "../../shared/module-host/host";
import { currentEvaluation } from "../../shared/api/evaluations";
import { PinnedChoice } from "../../shared/ui/pinned-choice";
import { RequestState } from "../../shared/ui/request-state";
import { detailHref, safeReturn } from "../../shared/ui/navigation";
import { useTaskOptions } from "../tasks/options";
const tabs = [
  "trace",
  "io",
  "scoring",
  "snapshot",
  "events",
  "history",
] as const;
function SnapshotModules({ execution }: { execution: Execution }) {
  const t = useMessages();
  const pipeline = execution.snapshot.pipeline as {
    graph: {
      nodes: {
        id: string;
        name: string;
        parameters: Record<string, unknown>;
        runtime?: unknown;
        module_snapshot?: Resource<Module>;
      }[];
    };
  };
  return (
    <div className="testflow-stack">
      {pipeline.graph.nodes
        .filter((n) => n.module_snapshot)
        .map((n) => (
          <Panel key={n.id} title={n.name}>
            <Json value={n.runtime} />
            <ModulePanel
              module={n.module_snapshot!}
              value={n.parameters}
              onChange={() => {}}
              readonly
            />
          </Panel>
        ))}
    </div>
  );
}
export function ExecutionDetail({ execution }: { execution: Execution }) {
  const t = useMessages();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get("tab") as (typeof tabs)[number] | null;
  const tab = requestedTab && tabs.includes(requestedTab) ? requestedTab : "trace";
  const [profileDialog, setProfileDialog] = useState(false);
  const [profileId, setProfileId] = useState("");
  const [profileVersion, setProfileVersion] = useState(1);
  const profiles = useResourceOptions<Profile>("evaluation-profiles");
  const [rerunKey] = useState(operationKey);
  const [scoreKey, setScoreKey] = useState(operationKey);
  const rerun = useWrite(() =>
    write<Execution>(
      `/executions/${execution.id}/rerun`,
      undefined,
      "POST",
      rerunKey,
    ),
  );
  const score = useWrite(() =>
    write<{ id: string; operation_id: string }>(
      `/${"executions"}/${execution.id}/reevaluate${profileId ? `?profile_id=${profileId}&profile_version=${profileVersion}` : ""}`,
      undefined,
      "POST",
      scoreKey,
    ),
  );
  const cancel = useWrite(() => write(`/executions/${execution.id}/cancel`));
  const nodeId =
    params.get("node") ||
    (execution.snapshot.pipeline as { graph: Pipeline }).graph.nodes.find(n=>n.kind==="module")?.id ||
    (execution.snapshot.pipeline as { graph: Pipeline }).graph.nodes[0]?.id;
  const node = execution.nodes[nodeId];
  const evaluations = execution.evaluations || [];
  const selectedEval =
    params.get("evaluation") || currentEvaluation(execution)?.id;
  const evaluation = evaluations.find((e) => e.id === selectedEval);
  const graph = execution.snapshot.pipeline as {
    name: string;
    selected_version: number;
    graph: Pipeline;
  };
  const caseSnapshot = execution.snapshot.case as { name: string };
  const pick = (v: Record<string, string>) =>
    setParams({ ...Object.fromEntries(params), ...v });
  const active = ["queued", "running"].includes(execution.state);
  const events = execution.events || [];
  const hasActualInputs = Object.keys(execution.actual_inputs || {}).length > 0;
  const bindings = hasActualInputs
    ? execution.actual_inputs
    : (execution.snapshot.inputs as Record<string, unknown>);
  const evidenceSource = params.get("evidence_source"),
    evidenceField = params.get("evidence_field") || "";
  const targeted = (source: string, field = "") =>
    evidenceSource === source &&
    (!evidenceField || source === "reference" || evidenceField === field);
  useEffect(() => {
    const target = document.querySelector<HTMLElement>(
      '[data-evidence-target="true"]',
    );
    if (target) {
      target.scrollIntoView({ block: "center" });
      target.focus({ preventScroll: true });
    }
  }, [evidenceSource, evidenceField, tab]);
  const panel =
    tab === "trace" ? (
      <div className="testflow-trace-grid">
        <Panel title={t.executions.nodeTimeline}>
          <TraceTimeline
            execution={execution}
            selected={nodeId}
            span={params.get("span")}
            onSelect={(node, span) => {
              const next = new URLSearchParams(params);
              next.set("node", node);
              if (span) next.set("span", span);
              else next.delete("span");
              setParams(next);
            }}
          />
        </Panel>
        <Panel title={node?.name || t.executions.inspector}>
          {node ? (
            <div className="testflow-stack">
              <Json
                value={{
                  node_id: node.id,
                  span_id: node.span_id,
                  trace_id: execution.trace_id,
                  state: node.state,
                  runtime_id: node.runtime_id,
                  image_id: node.image_id,
                  duration_ms: node.duration_ms,
                  error: node.error,
                }}
              />
              <div className="testflow-grid-2">
                <div>
                  <h3>{t.common.inputSchema}</h3>
                  <Json value={node.input} />
                </div>
                <div>
                  <h3>{t.common.outputSchema}</h3>
                  <Json value={node.output} />
                </div>
              </div>
              {events
                .filter(
                  (e) =>
                    e.node_id === node.id &&
                    e.kind === "trace.internal" &&
                    (!params.get("span") ||
                      String(e.data.span_id) === params.get("span")),
                )
                .map((event) => (
                  <Panel key={event.id} title={String(event.data.name)}>
                    <Json value={event.data} />
                  </Panel>
                ))}
            </div>
          ) : (
            <Empty text={t.common.empty} />
          )}
        </Panel>
      </div>
    ) : tab === "io" ? (
      <Panel
        title={t.executions.io}
        actions={
          <Action
            size="sm"
            action="export-execution"
            onPress={() => download(`${execution.id}.json`, execution)}
          >
            <Download />
            {t.common.export}
          </Action>
        }
      >
        <Json
          value={{
            inputs: bindings,
            output: execution.output,
            winner: execution.winner,
            reference: execution.snapshot.reference,
          }}
        />
      </Panel>
    ) : tab === "scoring" ? (
      <div className="testflow-stack">
        <Choice
          label={t.executions.evaluationRecord}
          value={selectedEval}
          options={evaluations.map((e) => ({
            id: e.id,
            name: `${e.profile.name} v${e.profile.selected_version} · ${new Date(e.created).toLocaleString()} · ${e.state}`,
          }))}
          onChange={(evaluation) => pick({ evaluation })}
        />
        {evaluation ? (
          <>
            <Status value={evaluation.state} />
            <Failure error={evaluation.error} />
            {evaluation.result.dimensions?.map((d) => (
              <Panel
                key={d.id}
                title={d.name}
                actions={<Status value={d.state} />}
              >
                <div className="testflow-stack">
                  <div className="testflow-row">
                    <Badge>
                      {t.evaluation.methods[
                        d.method as keyof typeof t.evaluation.methods
                      ] || d.method}
                    </Badge>
                    <strong>
                      {d.score == null
                        ? "—"
                        : d.method === "cer"
                          ? `${(d.score * 100).toFixed(2)}% / ≤ ${((d.threshold || 0) * 100).toFixed(2)}%`
                          : `${d.score.toFixed(3)} / ≥ ${d.method === "duration" ? 1 : (d.threshold ?? 1)}`}
                    </strong>
                    <span>{d.reason || d.error?.message}</span>
                  </div>
                  <Json value={d.bindings} />
                  <div className="testflow-row">
                    {[
                      ...new Set([
                        "actual",
                        ...(d.bindings.reference ? ["reference"] : []),
                        ...d.bindings.evidence.map((_, i) => `evidence:${i}`),
                        ...(d.evidence || []),
                      ]),
                    ].map((evidence) => (
                      <Action
                        key={evidence}
                        size="sm"
                        onPress={() => {
                          const binding =
                            evidence === "actual"
                              ? d.bindings.actual
                              : evidence === "reference"
                                ? d.bindings.reference
                                : d.bindings.evidence[
                                    Number(evidence.split(":")[1])
                                  ];
                          const next = new URLSearchParams(params);
                          next.delete("span");
                          next.set(
                            "tab",
                            binding?.source === "node"
                              ? "trace"
                              : binding?.source === "events"
                                ? "events"
                                : "io",
                          );
                          if (binding?.source === "node")
                            next.set("node", binding.node_id || "");
                          next.set("evidence_source", binding?.source || "");
                          next.set("evidence_field", binding?.field || "");
                          setParams(next);
                        }}
                      >
                        {t.executions.evidence} ·{" "}
                        {evidence === "actual"
                          ? t.evaluation.actual
                          : evidence === "reference"
                            ? t.evaluation.reference
                            : `${t.evaluation.evidence} ${Number(evidence.split(":")[1]) + 1}`}
                      </Action>
                    ))}
                  </div>
                </div>
              </Panel>
            ))}
          </>
        ) : (
          <Empty text={t.executions.noEvaluation} />
        )}
      </div>
    ) : tab === "snapshot" ? (
      <div className="testflow-grid-2">
        <Panel title={t.executions.snapshot}>
          <Json value={execution.snapshot} />
        </Panel>
        <SnapshotModules execution={execution} />
      </div>
    ) : tab === "events" ? (
      <Panel title={t.executions.events}>
        <DataTable
          label={t.executions.events}
          headers={["ID", t.common.created, "Type", t.executions.inspector]}
          rows={events.map((e) => ({
            id: String(e.id),
            cells: [
              e.id,
              new Date(e.created).toLocaleTimeString(),
              e.kind,
              <Json value={e.data} />,
            ],
          }))}
        />
      </Panel>
    ) : (
      <Panel title={t.executions.history}>
        <DataTable
          label={t.executions.history}
          headers={[
            t.common.name,
            t.common.status,
            t.common.created,
            t.common.actions,
          ]}
          rows={(execution.attempts || []).map((ex) => ({
            id: ex.id,
            cells: [
              `#${ex.attempt} · ${ex.name}`,
              <Status value={ex.state} />,
              new Date(ex.created).toLocaleString(),
              <Action
                size="sm"
                onPress={() =>
                  navigate(
                    detailHref(
                      "/executions/" + ex.id,
                      safeReturn(params.get("return"), "/executions"),
                    ),
                  )
                }
              >
                {t.common.details}
              </Action>,
            ],
          }))}
        />
      </Panel>
    );
  return (
    <>
      <Head
        title={caseSnapshot?.name || execution.name}
        meta={`${execution.id} · ${graph.name} v${graph.selected_version}`}
        actions={
          <>
            <Action
              action="execution-back"
              onPress={() =>
                navigate(
                  safeReturn(
                    params.get("return"),
                    "/executions" +
                      (execution.task_id
                        ? "?task_id=" + execution.task_id
                        : ""),
                  ),
                )
              }
            >
              {t.common.back}
            </Action>
            {active ? (
              <Action
                danger
                action="cancel-case"
                isPending={cancel.isPending}
                onPress={() => cancel.mutate(undefined)}
              >
                {t.executions.cancel}
              </Action>
            ) : (
              <Action
                action="rerun-execution"
                isPending={rerun.isPending}
                onPress={() =>
                  rerun.mutate(undefined, {
                    onSuccess: (ex) =>
                      navigate(
                        detailHref(
                          "/executions/" + ex.id,
                          safeReturn(params.get("return"), "/executions"),
                        ),
                      ),
                  })
                }
              >
                <RotateCcw />
                {t.executions.rerun}
              </Action>
            )}
            <Action
              primary
              action="reevaluate-execution"
              isDisabled={
                active ||
                evaluations.some((e) => ["queued", "running"].includes(e.state))
              }
              onPress={() => setProfileDialog(true)}
            >
              <JudgeIcon />
              {t.executions.reevaluate}
            </Action>
          </>
        }
      />
      <Failure error={rerun.error || score.error || cancel.error} />
      {execution.snapshot.live === true && active && (
        <LiveInput
          executionId={execution.id}
          schema={graph.graph.input_schema}
        />
      )}
      <div className="testflow-row testflow-mb">
        <Status value={execution.state} />
        {evaluation?.result.verdict==="error"?<Badge state="failed">{t.executions.evaluationError}</Badge>:<Status value={evaluation?.result.verdict || "unscored"} />}
        <Status value={execution.cleanup} />
        <span className="testflow-muted testflow-small">
          {execution.winner
            ? `${t.executions.resultSource}: ${graph.graph.nodes.find(n=>n.id===execution.winner)?.name || execution.winner}`
            : execution.error
              ? JSON.stringify(execution.error)
              : ""}
        </span>
      </div>
      <ExecutionMaterials execution={execution} graph={graph.graph} bindings={bindings} captured={hasActualInputs} targeted={targeted} />
      <ExecutionSummary execution={execution} evaluation={evaluation} graph={graph.graph} />
      <Tabs
        className="testflow-execution-tabs"
        selectedKey={tab}
        onSelectionChange={(value) => pick({ tab: String(value) })}
      >
        <Tabs.List className="testflow-tabs" aria-label={t.executions.title}>
          {tabs.map((v) => (
            <Tabs.Tab
              key={v}
              id={v}
              className="testflow-btn"
              data-a="execution-tab"
            >
              {t.executions[v]}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {tabs.map((v) => (
          <Tabs.Panel key={v} id={v} className="testflow-tab-content">
            {tab === v && panel}
          </Tabs.Panel>
        ))}
      </Tabs>
      {profileDialog && (
        <Dialog
          title={t.executions.reevaluate}
          onClose={() => setProfileDialog(false)}
          footer={
            <>
              <Action onPress={() => setProfileDialog(false)}>
                {t.common.cancel}
              </Action>
              <Action
                primary
                isPending={score.isPending}
                onPress={() =>
                  score.mutate(undefined, {
                    onSuccess: (record) => {
                      setProfileDialog(false);
                      setScoreKey(operationKey());
                      pick({ tab: "scoring", evaluation: record.id });
                    },
                  })
                }
              >
                {t.executions.reevaluate}
              </Action>
            </>
          }
        >
          <div className="testflow-stack">
            <PinnedChoice
              kind="evaluation-profiles"
              label={t.evaluation.title}
              id={profileId || "__snapshot"}
              version={profileVersion}
              resources={[
                {
                  ...(execution.snapshot.profile as Resource<Profile>),
                  id: "__snapshot",
                  name: t.executions.snapshot,
                },
                ...(profiles.data?.items || []),
              ]}
              onChange={(id, version) => {
                setScoreKey(operationKey());
                setProfileId(id === "__snapshot" ? "" : id);
                setProfileVersion(version);
              }}
            />
            <Notice>{t.executions.reevaluateHint}</Notice>
            <Failure error={score.error} />
          </div>
        </Dialog>
      )}
    </>
  );
}
export function ExecutionsPage() {
  const compactDateTime = useCompactDateTime();
  const t = useMessages();
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page") || 1);
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ["executions", params.toString()],
    queryFn: () => getJson<Page<Execution>>("/executions?" + params.toString()),
  });
  const detail = useQuery({
    queryKey: ["execution", id],
    queryFn: () => getJson<Execution>("/executions/" + id),
    enabled: !!id,
  });
  const datasets = useResourceOptions<Dataset>("datasets");
  const pipelines = useResourceOptions<Pipeline>("pipelines");
  const tasks = useTaskOptions(params.get("task_id") || undefined);
  const filter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.delete("page");
    if (value === "__all" || !value) next.delete(key);
    else next.set(key, value);
    setParams(next);
  };
  if (detail.data) return <ExecutionDetail execution={detail.data} />;
  if (id)
    return (
      <RequestState
        error={detail.error}
        retry={() => {
          void detail.refetch();
        }}
        back={() => navigate("/executions")}
      />
    );
  return (
    <>
      <Head
        title={t.executions.title}
        actions={
          <>
            {params.get("return") && (
              <Action
                onPress={() =>
                  navigate(safeReturn(params.get("return"), "/test-tasks"))
                }
              >
                {t.common.back}
              </Action>
            )}

          </>
        }
      />
      <div className="testflow-toolbar testflow-history-filters">
        <Text
          label={t.executions.search}
          placeholder={t.executions.searchPlaceholder}
          value={params.get("search") || ""}
          onChange={(v) => filter("search", v)}
        />
        <Choice
          label={t.common.status}
          value={params.get("state") || "__all"}
          options={[
            { id: "__all", name: t.executions.allStates },
            ...["queued", "running", "succeeded", "failed", "canceled"].map(
              (id) => ({
                id,
                name: t.common.states[id as keyof typeof t.common.states],
              }),
            ),
          ]}
          onChange={(v) => filter("state", v)}
        />
        <Choice
          label={t.datasets.title}
          className="testflow-history-dataset"
          value={params.get("dataset_id") || "__all"}
          options={[
            { id: "__all", name: t.executions.allDatasets },
            ...(datasets.data?.items || []),
          ]}
          onChange={(v) => filter("dataset_id", v)}
        />
        <Choice
          label={t.pipelines.title}
          className="testflow-history-pipeline"
          value={params.get("pipeline_id") || "__all"}
          options={[
            { id: "__all", name: t.executions.allPipelines },
            ...(pipelines.data?.items || []),
          ]}
          onChange={(v) => filter("pipeline_id", v)}
        />
        <Choice
          label={t.executions.attempts}
          value={params.get("all_attempts") || "true"}
          options={[
            { id: "true", name: t.executions.attempts },
            { id: "false", name: t.executions.current },
          ]}
          onChange={(v) => filter("all_attempts", v)}
        />
        <Choice
          label={t.tasks.title}
          className="testflow-history-task"
          value={params.get("task_id") || "__all"}
          options={[{id:"__all",name:t.executions.allTasks},...(tasks.data || [])]}
          onChange={(v)=>filter("task_id",v)}
        />
        <Action variant="ghost" className="testflow-link" action="clear-history" onPress={() => setParams(params.get("return") ? {return:params.get("return")!} : {})}>{t.common.clear}</Action>
      </div>
      <Failure error={query.error || detail.error} />
      <Panel>
        {query.data?.items.length ? (
          <DataTable
            label={t.executions.title}
            className="testflow-history-table"
            headers={[
              t.executions.caseExecution,
              t.executions.input,
              t.executions.finalOutput,
              t.datasets.title,
              t.executions.pipelineColumn,
              t.executions.runColumn,
              t.executions.verdictColumn,
              t.executions.cleanupColumn,
              t.common.duration,
              t.executions.startedColumn,
              "",
            ]}
            rows={query.data.items.map((ex) => ({
              id: ex.id,
              cells: [
                <div>
                  <Action variant="ghost" className="testflow-link testflow-cell-title" action="execution-detail" onPress={()=>navigate(detailHref("/executions/"+ex.id,"/executions?"+params.toString()))}>{ex.name}</Action>
                  <div className="testflow-row-subtitle testflow-mono">
                    {ex.id.slice(0, 8)} · {t.executions.attempt} {ex.attempt}
                  </div>
                </div>,
                <ExecutionMediaPreview materials={executionPreview(ex)} sourceCase={ex.snapshot.dataset ? {datasetId: (ex.snapshot.dataset as {id:string}).id, caseId: (ex.snapshot.case as {id:string}).id} : undefined} />,
                <ExecutionMediaPreview materials={executionPreview(ex)} output />,
                <><span className="testflow-small">{(ex.snapshot.dataset as {name?:string} | undefined)?.name || "—"}</span><div className="testflow-cell-subtitle testflow-tiny">v{(ex.snapshot.dataset as {selected_version?:number;version?:number} | undefined)?.selected_version || (ex.snapshot.dataset as {version?:number} | undefined)?.version || "—"}</div></>,
                <><span className="testflow-small">{(ex.snapshot.pipeline as { name: string }).name}</span><div className="testflow-cell-subtitle testflow-tiny">v{(ex.snapshot.pipeline as { selected_version?:number }).selected_version || "—"}</div></>,
                <Status value={ex.state} />,
                <Status
                  value={currentEvaluation(ex)?.result.verdict || "unscored"}
                  label={currentEvaluation(ex)?.result.verdict === "error" ? t.executions.evaluationError : undefined}
                />,
                <Status value={ex.cleanup} />,
                <span className="testflow-mono">{ex.duration_ms == null ? "—" : (ex.duration_ms/1000).toFixed(2)+" s"}</span>,
                <span className="testflow-mono">{compactDateTime(ex.created)}</span>,
                <Action
                  size="sm"
                  variant="ghost"
                  action="execution-detail"
                  aria-label={t.common.details}
                  onPress={() =>
                    navigate(
                      detailHref(
                        "/executions/" + ex.id,
                        "/executions?" + params.toString(),
                      ),
                    )
                  }
                >
                  <ArrowRight />
                </Action>,
              ],
            }))}
          />
        ) : (
          !query.isPending && <Empty text={t.common.empty} />
        )}
        <div className="testflow-history-footer"><span>{query.data?.total || 0} {t.executions.historyRetention}</span><span>{t.executions.independentAppend}</span></div>
        <Pagination
          page={page}
          total={query.data?.total || 0}
          onChange={(page) =>
            setParams({ ...Object.fromEntries(params), page: String(page) })
          }
        />
      </Panel>
    </>
  );
}
