import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useMessages } from "../../i18n";
import { getJson } from "../../shared/api/client";
import { useResourceOptions } from "../../shared/api/hooks";
import type { Repository, Runtime } from "../../shared/api/types";
import { CredentialSelect } from "../../shared/ui/resources";
import { Badge, Choice, Failure, Notice, Text } from "../../shared/ui";
export function RuntimeEditor({
  value,
  onChange,
  readonly = false,
}: {
  value: Runtime;
  onChange: (value: Runtime) => void;
  readonly?: boolean;
}) {
  const t = useMessages();
  const repositories = useResourceOptions<Repository>("repositories");
  const [repoId, setRepoId] = useState(value.code_mount?.repository_id || "");
  const versions = useQuery({
    queryKey: ["versions", "repositories", repoId],
    queryFn: () =>
      getJson<{ items: { number: number; data: Repository }[] }>(
        `/repositories/${repoId}/versions`,
      ),
    enabled: !!repoId,
  });
  const patch = (changes: Partial<Runtime>) =>
    onChange({ ...value, ...changes });
  const select = (number: number, commit: string) =>
    patch({
      code_mount: {
        repository_id: repoId,
        repository_version: number,
        commit,
        mount_path: value.code_mount?.mount_path || "/workspace/code",
      },
    });
  return (
    <div className="testflow-stack">
      <Badge state="running">Kubernetes Pod</Badge>
      <Text
        label={t.modules.image}
        value={value.image}
        disabled={readonly}
        onChange={(image) => patch({ image })}
      />
      <Text label={t.modules.port} type="number" value={value.port ?? 8080} disabled={readonly}
        onChange={(port) => patch({port: Number(port)})} />
      {!readonly && (
        <CredentialSelect
          kind="registry"
          value={value.registry_credential_id}
          onChange={(registry_credential_id) =>
            patch({ registry_credential_id: registry_credential_id || null })
          }
        />
      )}
      <Choice
        label={t.modules.mount}
        value={repoId || "__none"}
        disabled={readonly}
        options={[
          { id: "__none", name: "—" },
          ...(repositories.data?.items || []),
        ]}
        onChange={(id) => {
          setRepoId(id === "__none" ? "" : id);
          const repo = repositories.data?.items.find((r) => r.id === id);
          patch({
            code_mount: repo?.data.commit
              ? {
                  repository_id: repo.id,
                  repository_version: repo.selected_version,
                  commit: repo.data.commit,
                  mount_path: value.code_mount?.mount_path || "/workspace/code",
                }
              : id === "__none"
                ? null
                : {
                    repository_id: id,
                    repository_version: repo?.version || 1,
                    commit: "",
                    mount_path:
                      value.code_mount?.mount_path || "/workspace/code",
                  },
          });
        }}
      />
      {repoId && (
        <Choice
          label={t.pipelines.binding}
          disabled={readonly}
          value={
            value.code_mount?.repository_id === repoId
              ? String(value.code_mount.repository_version)
              : ""
          }
          options={(versions.data?.items || [])
            .filter((v) => v.data.commit && v.data.code_path)
            .map((v) => ({
              id: String(v.number),
              name: `v${v.number} · ${v.data.commit!.slice(0, 12)}`,
            }))}
          onChange={(v) => {
            const entry = versions.data?.items.find(
              (r) => r.number === Number(v),
            );
            if (entry?.data.commit) select(entry.number, entry.data.commit);
          }}
        />
      )}
      {repoId && !value.code_mount?.commit && (
        <Notice error>{t.modules.commitRequired}</Notice>
      )}
      {value.code_mount && (
        <>
          <Text
            label={t.modules.mountPath}
            value={value.code_mount.mount_path}
            disabled={readonly}
            onChange={(mount_path) =>
              patch({ code_mount: { ...value.code_mount!, mount_path } })
            }
          />
          <code>{value.code_mount.commit}</code>
        </>
      )}
      <Choice
        label={t.modules.reuse}
        value={value.reuse_scope}
        disabled={readonly}
        onChange={(reuse_scope) =>
          patch({ reuse_scope: reuse_scope as Runtime["reuse_scope"] })
        }
        options={[
          { id: "batch_node", name: t.modules.batchReuse },
          { id: "execution_node", name: t.modules.executionReuse },
        ]}
      />
      <div className="testflow-form-row">
        <Text
          label="CPU"
          value={value.cpu || "500m"}
          disabled={readonly}
          onChange={(cpu) => patch({ cpu })}
        />
        <Text
          label={t.modules.memory}
          value={value.memory || "512Mi"}
          disabled={readonly}
          onChange={(memory) => patch({ memory })}
        />
      </div>
      <Failure error={repositories.error || versions.error} />
      <Notice>{t.modules.note}</Notice>
    </div>
  );
}
