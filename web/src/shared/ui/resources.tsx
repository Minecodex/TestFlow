import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { KeyRound, RotateCcw, Trash2 } from "lucide-react";
import { getJson, write } from "../api/client";
import { useOperation, useWrite } from "../api/hooks";
import type { Credential, Resource } from "../api/types";
import { useMessages } from "../../i18n";
import { Action, DeleteAction, Choice, Dialog, Failure, Json, Notice, Status, Text } from ".";
export function DeleteResource({
  kind,
  resource,
}: {
  kind: string;
  resource: { id: string; name: string; hidden?: boolean };
}) {
  const t = useMessages();
  const [open, setOpen] = useState(false);
  const mutation = useWrite(() =>
    write(`/${kind}/${resource.id}/hide`),
  );
  return (
    <>
      {!resource.hidden && <DeleteAction action="hide-resource" data-resource-id={resource.id} aria-label={`${t.common.delete} ${resource.name}`} onPress={() => setOpen(true)} />}

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
                {t.common.confirmDelete}
              </Action>
            </>
          }
        >
          <Notice>
            {t.common.deleteConfirm}
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
function AccessCredential({ kind, onClose, onSaved }: {kind?: string; onClose: () => void; onSaved: (value: Credential) => void}) {
  const t = useMessages();
  const [name, setName] = useState("");
  const [type, setType] = useState(kind === "git" ? "git-http" : kind || "module");
  const [value, setValue] = useState("");
  const save = useWrite(() => write<Credential>("/credentials", {name, kind: type, value}));
  return <Dialog title={t.common.configureCredential} onClose={() => {if(!save.isPending) onClose();}}
    footer={<><Action isDisabled={save.isPending} onPress={onClose}>{t.common.cancel}</Action>
      <Action primary isPending={save.isPending} isDisabled={!name.trim() || !value.trim()} onPress={() => save.mutate(undefined, {onSuccess: onSaved})}>{t.common.save}</Action></>}>
    <div className="testflow-stack">
      <Text label={t.common.name} value={name} onChange={setName} />
      {kind === "git" && <Choice label={t.common.fieldType} value={type} options={[{id:"git-http", name:"HTTP Token"},{id:"git-ssh",name:"SSH"}]} onChange={setType} />}
      <Text label={t.common.credentialValue} type="password" multiline={type === "git-ssh" || type === "registry"} value={value} onChange={setValue} />
      <Failure error={save.error} />
    </div>
  </Dialog>;
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
  const [configuring, setConfiguring] = useState(false);
  const t = useMessages();
  return (
    <>
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
    <Action size="sm" onPress={() => setConfiguring(true)}><KeyRound />{t.common.configureCredential}</Action>
    {configuring && <AccessCredential kind={kind} onClose={() => setConfiguring(false)} onSaved={value => {onChange(value.id);setConfiguring(false);}} />}
    </>
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
