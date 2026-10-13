import { EditAction } from "../../shared/ui";
import { useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { Pencil, Plus } from "lucide-react";
import { useMessages } from "../../i18n";
import { useResource, useResources } from "../../shared/api/hooks";
import type { Profile, Resource } from "../../shared/api/types";
import {Action, Badge, DataTable, Dialog, Empty, Failure, Head, Pagination, Panel} from "../../shared/ui";
import { DeleteResource, Versions } from "../../shared/ui/resources";
import { RequestState } from "../../shared/ui/request-state";
import { useListState } from "../../shared/ui/list-state";
import { ProfileEditor } from "./editor";

export function EvaluationPage() {
  const t = useMessages();
  const { id } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const list = useListState();
  const query = useResources<Profile>("evaluation-profiles", list.query);
  const selected = useResource<Profile>(
    "evaluation-profiles",
    id || params.get("view") || undefined,
  );
  const [editing, setEditing] = useState<
    Resource<Profile> | null | undefined
  >();
  const [versions, setVersions] = useState<Resource<Profile>>();
  const closeDetails = () => {
    const search = new URLSearchParams(params);
    search.delete("view");
    navigate({ pathname: "/evaluation-profiles", search: search.toString() });
  };
  const profile = selected.data;
  return (
    <>
      <Head
        title={t.evaluation.title}
        actions={
          <Action primary action="new-profile" onPress={() => setEditing(null)}>
            <Plus />
            {t.evaluation.add}
          </Action>
        }
      />
      <Failure error={query.error} />
      <div className="testflow-grid-2 testflow-mb">
        {query.data?.items.map((p) => (
          <article className="testflow-card testflow-profile-card" key={p.id}>
            <Link
              className="testflow-profile-card-link"
              to={`/evaluation-profiles/${p.id}`}
              aria-label={`${t.common.details} ${p.name}`}
              data-a="select-profile"
            >
              <h2>{p.name}</h2>
              <dl className="testflow-profile-summary">
                <div>
                  <dt>{t.evaluation.rules}</dt>
                  <dd className="testflow-chips">
                    {(p.data.dimensions || [])
                      .filter((d) => d.method !== "ai")
                      .map((d) => (
                        <Badge key={d.id}>
                          {d.name || t.evaluation.methods[d.method]}
                        </Badge>
                      ))}
                    {!(p.data.dimensions || []).some(
                      (d) => d.method !== "ai",
                    ) && <span>{t.evaluation.noRules}</span>}
                  </dd>
                </div>
                <div>
                  <dt>{t.evaluation.model}</dt>
                  <dd>
                    {(p.data.dimensions || []).some((d) => d.method === "ai")
                      ? p.data.model || t.evaluation.modelMissing
                      : t.evaluation.noModel}
                  </dd>
                </div>
              </dl>
            </Link>
            <div className="testflow-resource-actions">
              <Badge>
                <Action
                  className="testflow-resource-version"
                  aria-label={t.common.versions}
                  onPress={() => setVersions(p)}
                >
                  v{p.version}
                </Action>
              </Badge>
              <div className="testflow-row">
                <DeleteResource kind="evaluation-profiles" resource={p} />
                <EditAction
                  size="sm"
                  action="edit-profile"
                  onPress={() => setEditing(p)}
                >
                  {t.common.edit}
                </EditAction>
              </div>
            </div>
          </article>
        ))}
      </div>
      {query.data?.total === 0 && <Empty text={t.common.empty} />}
      <Pagination
        page={list.page}
        total={query.data?.total || 0}
        onChange={list.onPage}
      />
      {(id || params.get("view")) && !profile && (
        <RequestState
          error={selected.error}
          retry={() => {
            void selected.refetch();
          }}
          back={closeDetails}
        />
      )}
      {profile && editing === undefined && (
        <Dialog
          title={profile.name}
          wide
          onClose={closeDetails}
          footer={
            <>
              <Action onPress={closeDetails}>{t.common.close}</Action>
              <Action size="sm" onPress={() => setVersions(profile)}>
                {t.common.versions}
              </Action>
              <EditAction
                primary
                action="edit-profile"
                onPress={() => setEditing(profile)}
              >
                {t.common.edit}
              </EditAction>
            </>
          }
        >
          <div className="testflow-stack">
            <div className="testflow-row testflow-between">
              <Badge>v{profile.selected_version}</Badge>
              {profile.data.description && (
                <span className="testflow-small">
                  {profile.data.description}
                </span>
              )}
            </div>
            <Panel title={t.evaluation.dimensions}>
              <DataTable
                label={t.evaluation.dimensions}
                headers={[
                  t.evaluation.dimensionName,
                  t.evaluation.method,
                  t.evaluation.actual,
                  t.evaluation.required,
                  t.evaluation.threshold,
                ]}
                rows={(profile.data.dimensions || []).map((d) => ({
                  id: d.id,
                  cells: [
                    <span className="testflow-dimension-name">{d.name}</span>,
                    <Badge>{t.evaluation.methods[d.method]}</Badge>,
                    <span className="testflow-small">
                      {t.evaluation.sources[d.actual.source]} ·{" "}
                      {d.actual.node_id ? d.actual.node_id + "." : ""}
                      {d.actual.field || "*"}
                    </span>,
                    <Badge>{d.required ? t.common.yes : t.common.no}</Badge>,
                    <span className="testflow-mono">
                      {d.method === "cer"
                        ? `CER ≤ ${d.threshold ?? 0.1}`
                        : d.method === "duration"
                          ? `≤ ${d.threshold} ms`
                          : d.method === "structure"
                            ? t.evaluation.schemaMatch
                            : `≥ ${d.threshold ?? 1} / 1`}
                    </span>,
                  ],
                }))}
              />
            </Panel>
            <Panel title={t.evaluation.modelPrompt}>
              <dl className="testflow-definition-list">
                <div className="testflow-definition-row">
                  <dt>{t.evaluation.model}</dt>
                  <dd>{profile.data.model || t.evaluation.noModel}</dd>
                </div>
                <div className="testflow-definition-row">
                  <dt>{t.evaluation.endpoint}</dt>
                  <dd>{profile.data.endpoint || "—"}</dd>
                </div>
                <div className="testflow-definition-row">
                  <dt>{t.common.credential}</dt>
                  <dd>{profile.data.credential_id || t.common.noCredential}</dd>
                </div>
                <div className="testflow-definition-row">
                  <dt>{t.evaluation.temperature}</dt>
                  <dd>
                    {profile.data.temperature ?? t.evaluation.providerDefault}
                  </dd>
                </div>
                <div className="testflow-definition-row">
                  <dt>{t.evaluation.jsonMode}</dt>
                  <dd>{profile.data.response_format}</dd>
                </div>
                <div className="testflow-definition-row">
                  <dt>{t.evaluation.modalities}</dt>
                  <dd>{(profile.data.modalities || []).join(" · ")}</dd>
                </div>
              </dl>
              <h3>{t.evaluation.prompt}</h3>
              <pre className="testflow-json">{profile.data.prompt || "—"}</pre>
            </Panel>
            {(profile.data.dimensions || [])
              .filter((d) => d.needs_reference || d.method === "ai")
              .map((d) => (
                <Panel key={d.id} title={d.name}>
                  <dl className="testflow-definition-list">
                    {d.reference && (
                      <div className="testflow-definition-row">
                        <dt>{t.evaluation.reference}</dt>
                        <dd>
                          {t.evaluation.sources[d.reference.source]} ·{" "}
                          {d.reference.field || "*"}
                        </dd>
                      </div>
                    )}
                    {(d.evidence || []).map((binding, n) => (
                      <div key={n} className="testflow-definition-row">
                        <dt>
                          {t.evaluation.evidence} {n + 1}
                        </dt>
                        <dd>
                          {t.evaluation.sources[binding.source]} ·{" "}
                          {binding.node_id ? binding.node_id + "." : ""}
                          {binding.field || "*"}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {d.prompt && <pre className="testflow-json">{d.prompt}</pre>}
                </Panel>
              ))}
          </div>
        </Dialog>
      )}
      {editing !== undefined && (
        <ProfileEditor
          resource={editing || undefined}
          onClose={() => setEditing(undefined)}
        />
      )}
      {versions && (
        <Versions
          kind="evaluation-profiles"
          resource={versions}
          onClose={() => setVersions(undefined)}
        />
      )}
    </>
  );
}
