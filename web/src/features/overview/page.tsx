import { useCompactDateTime } from "../../shared/ui/date-time";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { detailHref } from "../../shared/ui/navigation";
import {
  ArrowRight,
  AudioLines,
  Box,
  ChevronRight,
  Clock,
  Database,
  GitBranch,
  Plus,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import { useMessages } from "../../i18n";
import { getJson } from "../../shared/api/client";
import type { Overview } from "../../shared/api/types";
import {
  Action,
  Badge,
  Choice,
  DataTable,
  Empty,
  Failure,
  Head,
  Panel,
  Notice,
  Status,
} from "../../shared/ui";
import { features } from "../../app/features";
import { useProfileVersions } from "./profiles";
import { AudioIcon, BoxIcon, DatabaseIcon, FlowIcon, HistoryIcon, JudgeIcon, RepoIcon } from "../../shared/icons";

export function OverviewPage() {
  const compactDateTime = useCompactDateTime();
  const t = useMessages();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = location.pathname + location.search;
  const [params, setParams] = useSearchParams();
  const profiles = useProfileVersions();
  const profileId = params.get("profile_id"),
    version = params.get("profile_version");
  const selected = profileId ? `${profileId}:${version || 1}` : "";
  useEffect(() => {
    if (!profileId && profiles.options[0]) {
      const [id, version] = profiles.options[0].id.split(":");
      setParams(
        { profile_id: id, profile_version: version },
        { replace: true },
      );
    }
  }, [profileId, profiles.options[0]?.id]);
  const query = useQuery({
    queryKey: ["overview", profileId, version],
    queryFn: () =>
      getJson<Overview>(
        `/system/overview${profileId ? `?profile_id=${encodeURIComponent(profileId)}&profile_version=${version || 1}` : ""}`,
      ),
    enabled: !profiles.isPending && (!!profileId || !profiles.options.length),
  });
  const data = query.data;
  const all = Object.values(data?.runs || {}).reduce(
    (sum, count) => sum + count,
    0,
  );
  const rate = (value?: number | null) =>
    value == null ? "—" : `${Math.round(value * 100)}%`;
  const reference = data?.reference,
    quality = data?.quality,
    latest = data?.tasks[0];
  const statistics = [
    {
      label: t.overview.total,
      value: String(all).padStart(2, "0"),
      note: t.overview.attemptsNote,
      icon: HistoryIcon,
    },
    {
      label: t.overview.referenceRate,
      value: rate(reference?.pass_rate),
      note: `${reference?.passed || 0} ${t.overview.passed} / ${reference?.valid || 0} ${t.overview.valid}`,
      icon: JudgeIcon,
    },
    {
      label: t.overview.referenceCoverage,
      value: rate(reference?.coverage),
      note: `${reference?.valid || 0} ${t.overview.coverageValid} / ${reference?.expected || 0} ${t.overview.expected}`,
      icon: DatabaseIcon,
    },
    {
      label: t.overview.running,
      value: String(
        (data?.runs.running || 0) + (data?.runs.queued || 0),
      ).padStart(2, "0"),
      note: t.overview.concurrencyNote,
      icon: FlowIcon,
    },
  ];
  return (
    <div className="testflow-overview">
      <Head
        title={t.overview.title}
        actions={
          <Action
            primary
            action="new-task"
            onPress={() => navigate("/test-tasks?create=1")}
          >
            <Plus />
            {t.overview.newTask}
          </Action>
        }
      />
      <section className="testflow-intro">
        <div>
          <div className="testflow-eyebrow">BUILD · RUN · EVALUATE</div>
          <h2>{t.overview.welcome}</h2>
          <p>{t.overview.welcomeDescription}</p>
        </div>
        <div className="testflow-intro-glyph" aria-hidden="true">
          <span>
            <AudioIcon />
          </span>
          <b />
          <span>
            <FlowIcon />
          </span>
          <b />
          <span>
            <JudgeIcon />
          </span>
        </div>
      </section>
      <div className="testflow-journey">
        {features.map((feature, index) => (
          <Action
            key={feature.id}
            className="testflow-journey-step"
            variant="ghost"
            onPress={() => navigate(feature.path)}
          >
            <em>{String(index + 1).padStart(2, "0")}</em>
            <feature.icon />
            <span>{t[feature.id].title}</span>
          </Action>
        ))}
      </div>
      <Failure error={query.error || profiles.error} />
      <div className="testflow-toolbar testflow-overview-scope">
        <span>{t.overview.scopeNote}</span>
        <Choice
          label={t.overview.profile}
          value={selected}
          options={profiles.options}
          onChange={(value) => {
            const [id, version] = value.split(":");
            setParams({ profile_id: id, profile_version: version });
          }}
        />
      </div>
      <div className="testflow-grid-4 testflow-mb">
        {statistics.map((stat) => (
          <div className="testflow-stat" key={stat.label}>
            <div className="testflow-row testflow-between">
              <div className="testflow-stat-label">{stat.label}</div>
              <span className="testflow-stat-icon">
                <stat.icon />
              </span>
            </div>
            <div className="testflow-stat-value">{stat.value}</div>
            <div className="testflow-stat-note">{stat.note}</div>
          </div>
        ))}
      </div>
      <div className="testflow-overview-panels">
        <Panel
          title={t.overview.recent}
          actions={
            <Action
              size="sm"
              variant="ghost"
              className="testflow-link"
              onPress={() => navigate("/test-tasks")}
            >
              {t.overview.allTasks}
              <ArrowRight />
            </Action>
          }
        >
          {data?.tasks.length ? (
            <DataTable
              label={t.overview.recent}
              headers={[
                t.overview.taskBatch,
                t.tasks.pair,
                t.tasks.runProgress,
                t.common.status,
                t.common.created,
                "",
              ]}
              rows={data.tasks.map((task) => ({
                id: task.id,
                cells: [
                  <div>
                    <Action
                      size="sm"
                      variant="ghost"
                      className="testflow-link testflow-task-title"
                      onPress={() => navigate(detailHref("/test-tasks/" + task.id,returnTo))}
                    >
                      {task.name}
                    </Action>
                    <div className="testflow-row-subtitle testflow-muted testflow-mono">{task.id.slice(0,16)}</div>
                  </div>,
                  `${task.snapshot.pairs?.length || 0} ${t.tasks.pairUnit}`,
                  <div className="testflow-progress-cell">
                    <div className="testflow-row testflow-between">
                      <span>
                        {task.report.run_completed} / {task.report.plan_count}
                      </span>
                      <span className="testflow-muted">
                        {Math.round(
                          (task.report.run_completed /
                            (task.report.plan_count || 1)) *
                            100,
                        )}
                        %
                      </span>
                    </div>
                    <div className="testflow-progress">
                      <span
                        style={{
                          width: `${(task.report.run_completed / (task.report.plan_count || 1)) * 100}%`,
                        }}
                      />
                    </div>
                  </div>,
                  <Status value={task.state} />,
                  <span className="testflow-mono testflow-muted">{compactDateTime(task.created)}</span>,
                  <Action
                    size="sm"
                    variant="ghost"
                    action="task-report"
                    onPress={() => navigate(detailHref("/test-tasks/" + task.id,returnTo))}
                  >
                    {t.tasks.reportLabel}<ArrowRight />
                  </Action>,
                ],
              }))}
            />
          ) : (
            <Empty text={t.common.empty} />
          )}
        </Panel>
        <Panel
          className="testflow-resource-panel"
          title={t.overview.features}
          actions={
            <Badge state="ready">{t.overview.realData}</Badge>
          }
        >
          <div className="testflow-resource-list">
            {[
              {
                label: t.overview.repositories,
                count: data?.counts.repositories || 0,
                path: "/repositories",
                icon: RepoIcon,
              },
              {
                label: t.overview.modules,
                count: data?.counts.modules || 0,
                path: "/modules",
                icon: BoxIcon,
              },
              {
                label: t.overview.datasetsFlows,
                count: `${data?.counts.datasets || 0} / ${data?.counts.pipelines || 0}`,
                path: "/pipelines",
                icon: FlowIcon,
              },
            ].map((resource) => (
              <Action
                key={resource.path}
                className="testflow-resource-summary"
                variant="ghost"
                onPress={() => navigate(resource.path)}
              >
                <span className="testflow-resource-icon">
                  <resource.icon />
                </span>
                <span className="testflow-grow">{resource.label}</span>
                <strong>{resource.count}</strong>
                <ChevronRight />
              </Action>
            ))}
          </div>
        </Panel>
        <Panel title={t.overview.latestDistribution} actions={<small className="testflow-muted">{latest?.name}</small>}>
          {latest ? (
            <>
              <div className="testflow-row testflow-between">
                <div><div className="testflow-eyebrow">{t.overview.caseResults}</div>
                  <div className="testflow-stat-value testflow-batch-value">{latest.report.run_completed}<small> / {latest.report.plan_count}</small></div>
                </div>
                <p className="testflow-small testflow-muted">{t.overview.failureNote}<br/>{t.overview.continueNote}</p>
              </div>
              <div className="testflow-run-distribution">
                {latest.report.rows.map((row, index) => (
                  <Action
                    key={row.item_id}
                    isDisabled={!row.execution_id && !row.active_execution_id}
                    onPress={() =>
                      navigate(
                        "/executions/" +
                          (row.active_execution_id || row.execution_id),
                      )
                    }
                    className="testflow-run-bar"
                    variant="ghost"
                  >
                    <small>
                      {row.duration_ms == null
                        ? "—"
                        : (row.duration_ms / 1000).toFixed(2) + " s"}
                    </small>
                    <span className={`testflow-spark-bar testflow-state-${row.execution_state}`}
                      style={{height: Math.min(120,Math.max(10,(row.duration_ms || 0)/30))}} />
                    <small>{t.common.states[(row.active_execution_id ? "running" : row.execution_state) as keyof typeof t.common.states] || row.execution_state} · {index + 1}</small>
                  </Action>
                ))}
              </div>
            </>
          ) : (
            <Empty text={t.common.empty} />
          )}
        </Panel>
        <Panel title={t.overview.profile} actions={<ShieldCheck />}>
          <div className="testflow-stack">
            <div className="testflow-row testflow-between">
              <span>{t.overview.qualityRate}</span>
              <strong>{rate(quality?.pass_rate)}</strong>
            </div>
            <div className="testflow-progress"><span style={{width:`${(quality?.coverage || 0)*100}%`}} /></div>
            <p className="testflow-muted testflow-small">
              {t.overview.scopeDescription}
            </p>
            <Notice>
              {t.overview.statesNote}
            </Notice>
          </div>
        </Panel>
      </div>
      <div className="testflow-overview-bottom">
        <span>{t.overview.historyNote}</span>
        <Action
          size="sm"
          variant="ghost"
          onPress={() => window.dispatchEvent(new Event("testflow:about"))}
        >
          {t.common.about}
        </Action>
      </div>
    </div>
  );
}
