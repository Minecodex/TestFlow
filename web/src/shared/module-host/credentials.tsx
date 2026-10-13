import { useState } from "react";
import { KeyRound } from "lucide-react";
import { useMessages } from "../../i18n";
import { Action, Dialog } from "../ui";
import { CredentialSelect } from "../ui/resources";

/** A business credential is an explicit Schema parameter, never a Pod registry credential. */
export function BusinessCredentials({ schema, value, onChange }: {
  schema: Record<string, unknown>; value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
}) {
  const t = useMessages(), [open, setOpen] = useState(false);
  const fields = Object.entries((schema.properties || {}) as Record<string, Record<string, unknown>>)
    .filter(([, field]) => field["x-testflow-credential"] === true && field.type === "string");
  if (!fields.length) return null;
  return <>
    <Action onPress={() => setOpen(true)}><KeyRound />{t.modules.businessCredentials}</Action>
    {open && <Dialog title={t.modules.businessCredentials} onClose={() => setOpen(false)}
      footer={<Action onPress={() => setOpen(false)}>{t.common.close}</Action>}>
      <div className="testflow-stack">{fields.map(([key, field]) => <div className="testflow-stack" key={key}>
        <strong>{String(field.title || key)}</strong>
        <CredentialSelect kind="module" value={typeof value[key] === "string" ? value[key] as string : undefined}
          onChange={id => onChange({...value, [key]: id || ""})} />
      </div>)}</div>
    </Dialog>}
  </>;
}
