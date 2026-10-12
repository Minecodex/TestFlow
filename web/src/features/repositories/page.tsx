import { useCompactDateTime } from "../../shared/ui/date-time";
import { useListState } from "../../shared/ui/list-state";
import { Pagination } from "../../shared/ui";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Code2, FileText, GitBranch, LockKeyhole, Pencil, Plus, RefreshCw } from "lucide-react";
import { useMessages } from "../../i18n";
import { ApiError, operationKey, write } from "../../shared/api/client";
import { useOperationKeys } from "../../shared/api/operation-keys";
import { useResources, useWrite } from "../../shared/api/hooks";
import type { Repository, Resource, Operation } from "../../shared/api/types";
import {
  Action,
  Badge,
  DataTable,
  Dialog,
  Empty,
  Failure,
  Head,
  Notice,
  Panel,
  Status,
  Text,
} from "../../shared/ui";
import {
  CredentialSelect,
  Hide,
  OperationStatus,
  Versions,
} from "../../shared/ui/resources";
import { DraftConflict } from "../../shared/ui/draft-conflict";
import { useVersionedDraft } from "../../shared/ui/versioned-draft";
import { CodeIcon, DatabaseIcon, LockIcon, RepoIcon } from "../../shared/icons";
function Editor({
  resource,
  onClose,
}: {
  resource?: Resource<Repository>;
  onClose: () => void;
}) {
  const t = useMessages();
  const draft = useVersionedDraft<Repository>("testflow.repository-draft."+(resource?.id || "new"),resource?.version || 0,
    resource?.data || {
      name: "",
      url: "",
      branch: "main",
      credential_id: null,
      description: "",
      commits: [],
      sync_state: "not_synced",
    },
  );
  const {data,setData} = draft;
  const patch = (value: Partial<Repository>) => setData({ ...data, ...value });
  const mutation = useWrite(() =>
    write(
      resource ? `/repositories/${resource.id}` : "/repositories",
      resource ? { expected_version: draft.baseVersion, data } : data,
      resource ? "PUT" : "POST",
    ),
  );
  const conflict = !!resource && mutation.error instanceof ApiError && mutation.error.status===409;
  return (
    <Dialog
      title={resource ? t.common.edit : t.repositories.add}
      onClose={() => {
        if (!mutation.isPending) onClose();
      }}
      footer={
        <>
          <Action isDisabled={mutation.isPending} onPress={onClose}>
            {t.common.cancel}
          </Action>
          <Action
            primary
            isPending={mutation.isPending}
            isDisabled={!data.name || !data.url || !data.branch || conflict}
            onPress={() => mutation.mutate(undefined, { onSuccess: ()=>{draft.clear();onClose();} })}
          >
            {t.common.save}
          </Action>
        </>
      }
    >
      <div className="testflow-stack">
        <Failure error={mutation.error} />
        {conflict && resource && <DraftConflict kind="repositories" id={resource.id} draft={data}
          onContinue={latest=>{draft.setBaseVersion(latest.version);mutation.reset();}} />}
        <Text
          label={t.common.name}
          value={data.name}
          onChange={(name) => patch({ name })}
          required
        />
        <Text
          label={t.repositories.url}
          value={data.url}
          onChange={(url) => patch({ url })}
          required
        />
        <Text
          label={t.repositories.branch}
          value={data.branch}
          onChange={(branch) => patch({ branch })}
          required
        />
        <CredentialSelect
          kind="git"
          value={data.credential_id}
          onChange={(credential_id) => patch({ credential_id })}
        />
        <Text
          label={t.common.description}
          value={data.description || ""}
          multiline
          onChange={(description) => patch({ description })}
        />
        <Notice>{t.repositories.syncNote}</Notice>
      </div>
    </Dialog>
  );
}
export function RepositoriesPage() {
  const compactDateTime = useCompactDateTime();
  const t = useMessages();
  const { id } = useParams();
  const navigate = useNavigate();
  const list = useListState();
  const query = useResources<Repository>("repositories", list.query);
  const [editing, setEditing] = useState<
    Resource<Repository> | null | undefined
  >();
  const [versions, setVersions] = useState<Resource<Repository>>();
  const [operation, setOperation] = useState<string>();
  const intents = useOperationKeys();
  const sync = useWrite((resource: Resource<Repository>) =>
    write<Operation>(
      `/repositories/${resource.id}/sync`,
      undefined,
      "POST",
      intents.key(
        resource.id,
        resource.data,
        resource.sync_operation as Operation | null,
      ),
    ),
  );
  return (
    <>
      <Head
        title={t.repositories.title}
        description={t.repositories.description}
        eyebrow="SOURCE / 02"
        actions={
          <Action primary action="new-repo" onPress={() => setEditing(null)}>
            <Plus />
            {t.repositories.add}
          </Action>
        }
      />
      <Failure error={query.error || sync.error} />
      <OperationStatus id={operation} />
      <Notice>{t.repositories.syncNote}</Notice>
      <Panel className="testflow-mt">
        {query.data?.items.length ? (
          <DataTable
            label={t.repositories.title}
            headers={[
              t.repositories.repositoryColumn,
              t.repositories.branch,
              t.repositories.resolvedVersion,
              t.repositories.access,
              t.repositories.syncState,
              t.repositories.syncedAt,
              "",
            ]}
            rows={query.data.items.map((r) => ({
              id: r.id,
              cells: [
                <div className="testflow-row">
                  <span className="testflow-resource-icon"><RepoIcon /></span>
                  <div>
                  <strong className="testflow-row-title">{r.name}</strong>
                  <div className="testflow-cell-subtitle testflow-tiny">
                    {r.data.url}
                  </div>
                  </div>
                </div>,
                <code>
                  {r.data.branch}
                </code>,
                <Action variant="ghost" className="testflow-link testflow-mono" action="repo-versions" aria-label={t.common.versions} onPress={()=>setVersions(r)}>
                  {r.data.commit?.slice(0, 12) || t.repositories.noCommit}
                </Action>,
                <Badge>{r.data.credential_id ? t.repositories.credentialAuth : t.repositories.noAuth}</Badge>,
                <div className="testflow-stack">
                  <Status
                    value={
                      (r.sync_operation?.state === "succeeded"
                        ? "ready"
                        : r.sync_operation?.state) ||
                      r.data.sync_state ||
                      "not_synced"
                    }
                  />
                  <Failure error={r.sync_operation?.error} />
                </div>,
                <span className="testflow-small testflow-muted testflow-mono">{r.data.synced_at ? compactDateTime(r.data.synced_at) : "—"}</span>,
                <div className="testflow-row-actions">
                  <Action
                    size="sm"
                    action="sync-repo"
                    aria-label={t.repositories.sync}
                    isPending={sync.isPending && sync.variables?.id === r.id}
                    isDisabled={["queued", "running"].includes(
                      r.sync_operation?.state || "",
                    )}
                    onPress={() =>
                      sync.mutate(r, {
                        onSuccess: (op) => {
                          intents.accepted(r.id, op);
                          setOperation(op.id);
                        },
                      })
                    }
                  >
                    <RefreshCw />
                    {t.repositories.syncLabel}
                  </Action>
                  <Action
                    size="sm"
                    action="edit-repo"
                    variant="ghost"
                    isIconOnly
                    aria-label={t.common.edit}
                    onPress={() => setEditing(r)}
                  >
                    <Pencil />
                  </Action>
                  <Hide kind="repositories" resource={r} iconOnly />
                </div>,
              ],
            }))}
          />
        ) : (
          !query.isPending && <Empty text={t.common.empty} />
        )}
      </Panel>
      <div className="testflow-grid-3 testflow-mt">
        {[
          {icon:<DatabaseIcon />, title:t.repositories.codeLocation, text:t.repositories.codeLocationNote},
          {icon:<LockIcon />, title:t.repositories.fixedHistory, text:t.repositories.fixedHistoryNote},
          {icon:<CodeIcon />, title:t.repositories.unchangedSource, text:t.repositories.unchangedSourceNote},
        ].map(item=><Panel key={item.title}><div className="testflow-row testflow-mb"><span className="testflow-module-icon">{item.icon}</span><h3>{item.title}</h3></div><p className="testflow-small testflow-muted">{item.text}</p></Panel>)}
      </div>
      <Pagination
        page={list.page}
        total={query.data?.total || 0}
        onChange={list.onPage}
      />
      {editing !== undefined && (
        <Editor
          resource={editing || undefined}
          onClose={() => setEditing(undefined)}
        />
      )}
      {versions && (
        <Versions
          kind="repositories"
          resource={versions}
          onClose={() => setVersions(undefined)}
        />
      )}
      {id && query.data?.items.find((r) => r.id === id) && (
        <Versions
          kind="repositories"
          resource={query.data.items.find((r) => r.id === id)!}
          onClose={() => navigate("/repositories")}
        />
      )}
    </>
  );
}
