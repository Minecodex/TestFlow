import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { EyeOff, KeyRound } from "lucide-react";
import { getJson, write } from "../api/client";
import { useOperation, useWrite } from "../api/hooks";
import type { Credential, Resource } from "../api/types";
import { useMessages } from "../../i18n";
import { Action, Choice, Dialog, Failure, Json, Notice, Status, Text } from ".";
import { HideIcon } from "../icons";
export function Hide({
  kind,
  resource,
  iconOnly = false,
}: {
  kind: string;
  resource: { id: string; name: string; hidden?: boolean };
  iconOnly?: boolean;
}) {
  const t = useMessages();
  const [open, setOpen] = useState(false);
  const mutation = useWrite(() =>
    write(`/${kind}/${resource.id}/${resource.hidden ? "restore" : "hide"}`),
  );
  return (
    <>
      <Action
        size="sm"
        isIconOnly={iconOnly}
        variant={iconOnly ? "ghost" : "outline"}
        action={resource.hidden ? "restore-resource" : "hide-resource"}
        data-resource-id={resource.id}
        aria-label={`${resource.hidden ? t.common.restore : t.common.hide} ${resource.name}`}
        onPress={() => setOpen(true)}
      >
        <HideIcon />
        {!iconOnly && (resource.hidden ? t.common.restore : t.common.hide)}
      </Action>
      {open && (
        <Dialog
          title={resource.name}
          onClose={() => {
            if (!mutation.isPending) setOpen(false);
          }}
          footer={
            <>
              <Action
                onPress={() => setOpen(false)}
                isDisabled={mutation.isPending}
              >
                {t.common.cancel}
              </Action>
              <Action
                action="confirm-hide"
                danger
                isPending={mutation.isPending}
                onPress={() =>
                  mutation.mutate(undefined, {
                    onSuccess: () => setOpen(false),
                  })
                }
              >
                {resource.hidden ? t.common.restore : t.common.confirmHide}
              </Action>
            </>
          }
        >
          <Notice>
            {resource.hidden ? t.common.restoreConfirm : t.common.hideConfirm}
          </Notice>
          <Failure error={mutation.error} />
        </Dialog>
      )}
    </>
  );
}
export function Versions({
  kind,
  resource,
  onClose,
}: {
  kind: string;
  resource: Resource<unknown>;
  onClose: () => void;
}) {
  const t = useMessages();
  const query = useQuery({
    queryKey: ["versions", kind, resource.id],
    queryFn: () =>
      getJson<{
        items: {
          id: string;
          number: number;
          data: unknown;
          created: string;
          digest: string;
        }[];
      }>(`/${kind}/${resource.id}/versions`),
  });
  const [version, setVersion] = useState(String(resource.version));
  return (
    <Dialog
      drawer
      title={`${resource.name} · ${t.common.versions}`}
      onClose={onClose}
    >
      <div className="testflow-stack">
        <Failure error={query.error} />
        <Choice
          label={t.common.version}
          value={version}
          onChange={setVersion}
          options={(query.data?.items || []).map((v) => ({
            id: String(v.number),
            name: `v${v.number} · ${new Date(v.created).toLocaleString()}`,
          }))}
        />
        <Json
          value={query.data?.items.find((v) => v.number === Number(version))}
        />
      </div>
    </Dialog>
  );
}
export function Credentials({ onClose }: { onClose: () => void }) {
  const t = useMessages();
  const query = useCredentials();
  const [name, setName] = useState("");
  const [kind, setKind] = useState("evaluation");
  const [value, setValue] = useState("");
  const mutation = useWrite(() => write("/credentials", { name, kind, value }));
  return (
    <Dialog
      title={t.common.credentials}
      onClose={onClose}
      footer={
        <Action
          primary
          isPending={mutation.isPending}
          isDisabled={!name || !value}
          onPress={() =>
            mutation.mutate(undefined, {
              onSuccess: () => {
                setName("");
                setValue("");
              },
            })
          }
        >
          {t.common.create}
        </Action>
      }
    >
      <div className="testflow-stack">
        <Failure error={mutation.error || query.error} />
        {query.data?.items.map((c) => (
          <div className="testflow-row" key={c.id}>
            <KeyRound />
            <strong>{c.name}</strong>
            <span>{c.kind}</span>
            <code>{c.id}</code>
          </div>
        ))}
        <Text label={t.common.name} value={name} onChange={setName} required />
        <Choice
          label={t.common.fieldType}
          value={kind}
          options={[
            "git-http",
            "git-ssh",
            "registry",
            "evaluation",
            "module",
          ].map((id) => ({ id, name: id }))}
          onChange={setKind}
        />
        <Text
          label={t.common.credentialValue}
          value={value}
          onChange={setValue}
          type="password"
          multiline={kind === "git-ssh" || kind === "registry"}
          required
        />
      </div>
    </Dialog>
  );
}
export function useCredentials() {
  return useQuery({
    queryKey: ["credentials"],
    queryFn: () => getJson<{ items: Credential[] }>("/credentials"),
  });
}
export function CredentialSelect({
  value,
  onChange,
  kind,
}: {
  value?: string | null;
  onChange: (v: string | null) => void;
  kind?: string;
}) {
  const query = useCredentials();
  const t = useMessages();
  return (
    <Choice
      label={t.common.credential}
      value={value || "__none"}
      onChange={(v) => onChange(v === "__none" ? null : v)}
      options={[
        { id: "__none", name: t.common.noCredential },
        ...(query.data?.items.filter(
          (c) =>
            !kind ||
            (kind === "git" ? c.kind.startsWith("git") : c.kind === kind),
        ) || []),
      ]}
    />
  );
}
export function OperationStatus({ id }: { id?: string }) {
  const query = useOperation(id);
  if (!id) return null;
  return (
    <div className="testflow-stack">
      <Failure error={query.error} />
      {query.data && (
        <>
          <Status value={query.data.state} />
          <Failure error={query.data.error?.message} />
          {query.data.state === "succeeded" && (
            <Notice>
              {query.data.result.superseded
                ? String(query.data.result.message)
                : query.data.result.commit
                  ? String(query.data.result.commit)
                  : "✓"}
            </Notice>
          )}
        </>
      )}
    </div>
  );
}
