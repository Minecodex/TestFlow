import { useResourceOptions } from "../../shared/api/hooks";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMessages } from "../../i18n";
import { useResource } from "../../shared/api/hooks";
import type {
  Asset,
  Binding,
  Case,
  Resource,
  Schema,
} from "../../shared/api/types";
import { PinnedChoice } from "../../shared/ui/pinned-choice";
import {
  Action,
  Check,
  Choice,
  Dialog,
  Failure,
  Json,
  JsonEditor,
  Notice,
  Text,
} from "../../shared/ui";
export function emptyCase(schema: Schema): Case {
  return {id:crypto.randomUUID(),name:"",inputs:Object.fromEntries(schema.fields
    .filter(field=>["Text","JSON"].includes(field.type))
    .map(field=>[field.name,{value:field.type==="JSON"?{}:""}])),reference:{},reference_confirmed:false};
}
function AssetChoice({
  resources,
  binding,
  onChange,
}: {
  resources: Resource<Asset>[];
  binding?: Binding;
  onChange: (value: Binding) => void;
}) {
  const t = useMessages();
  const selected = useResource<Asset>(
    "assets",
    binding?.asset_id || undefined,
    binding?.asset_version ? String(binding.asset_version) : undefined,
  );
  const options =
    selected.data && !resources.some((asset) => asset.id === selected.data?.id)
      ? [...resources, selected.data]
      : resources;
  return (
    <>
      <PinnedChoice
        kind="assets"
        label={t.datasets.asset}
        resources={options}
        id={binding?.asset_id || ""}
        version={binding?.asset_version || 1}
        onChange={(asset_id, asset_version) =>
          onChange({ asset_id, asset_version })
        }
      />
      <Failure error={selected.error} />
    </>
  );
}
export function InputBindings({
  schema,
  value,
  onChange,
  onValid,
}: {
  schema: Schema;
  value: Record<string, Binding>;
  onChange: (value: Record<string, Binding>) => void;
  onValid?: (valid: boolean) => void;
}) {
  const t = useMessages();
  const [validFields, setValidFields] = useState<Record<string, boolean>>({});
  const obsolete = Object.keys(value).filter(name=>!schema.fields.some(field=>field.name===name));
  useEffect(() => {
    onValid?.(
      obsolete.length === 0 && schema.fields.every((f) => {
        const binding = value[f.name];
        if (binding?.asset_id) return !!binding.asset_version;
        if (f.type === "Audio" || f.type === "Image") return false;
        return (
          !!binding &&
          (f.type !== "Text" || typeof binding.value === "string") &&
          binding.value !== undefined &&
          (f.type !== "JSON" || validFields[f.name] !== false)
        );
      }),
    );
  }, [validFields, schema, value, onValid]);
  const assets = useResourceOptions<Asset>("assets");
  return (
    <div className="testflow-stack">
      {schema.fields.map((f) => {
        const binding = value[f.name];
        const asset = !!binding?.asset_id;
        const available =
          assets.data?.items.filter(
            (a) => a.data.type === f.type && a.data.format === f.format,
          ) || [];
        return (
          <div className="testflow-outline" key={f.name}>
            <h3>
              {f.name} · {f.type}
            </h3>
            {["Text", "JSON"].includes(f.type) && (
              <Choice
                label={t.datasets.inputValue}
                value={asset ? "asset" : "literal"}
                options={[
                  { id: "literal", name: t.datasets.literal },
                  { id: "asset", name: t.datasets.asset },
                ]}
                onChange={(mode) =>
                  onChange({
                    ...value,
                    [f.name]:
                      mode === "literal"
                        ? { value: f.type === "JSON" ? {} : "" }
                        : {
                            asset_id: available[0]?.id,
                            asset_version: available[0]?.version,
                          },
                  })
                }
              />
            )}{" "}
            {asset || ["Audio", "Image"].includes(f.type) ? (
              <AssetChoice
                resources={available}
                binding={binding}
                onChange={(binding) =>
                  onChange({ ...value, [f.name]: binding })
                }
              />
            ) : f.type === "JSON" ? (
              <JsonEditor
                objectOnly={false}
                label={f.name}
                value={binding && "value" in binding ? binding.value : {}}
                onValid={(valid) =>
                  setValidFields((previous) =>
                    previous[f.name] === valid
                      ? previous
                      : { ...previous, [f.name]: valid },
                  )
                }
                onChange={(v) => onChange({ ...value, [f.name]: { value: v } })}
              />
            ) : (
              <Text
                label={f.name}
                value={String(binding?.value ?? "")}
                multiline
                onChange={(v) => onChange({ ...value, [f.name]: { value: v } })}
              />
            )}
          </div>
        );
      })}
      {obsolete.map(name=><div className="testflow-outline" key={name}>
        <Notice error>{t.datasets.obsoleteInput}: {name}</Notice>
        <Json value={value[name]} />
        <Action onPress={()=>{const next={...value};delete next[name];onChange(next);}}>{t.datasets.removeBinding}</Action>
      </div>)}
      <Failure error={assets.error} />
    </div>
  );
}
export function CaseEditor({
  initial,
  schema,
  onSave,
  onClose,
  extra,
  blocked = false,
  pending = false,
  onDraftChange,
  creating = false,
}: {
  initial?: Case;
  schema: Schema;
  onSave: (value: Case) => void;
  onClose: () => void;
  extra?: ReactNode;
  blocked?: boolean;
  pending?: boolean;
  onDraftChange?: (value: Case)=>void;
  creating?: boolean;
}) {
  const t = useMessages();
  const [value, setValue] = useState<Case>(
    initial || emptyCase(schema),
  );
  const [valid, setValid] = useState(true);
  const [inputValid, setInputValid] = useState(true);
  const draftChanged = useRef(onDraftChange);
  draftChanged.current = onDraftChange;
  useEffect(()=>draftChanged.current?.(value),[value]);
  const ready =
    !!value.name &&
    valid &&
    inputValid &&
    schema.fields.every(
      (f) =>
        value.inputs[f.name]?.asset_id ||
        value.inputs[f.name]?.value !== undefined,
    );
  return (
    <Dialog
      title={!creating && initial ? t.common.edit : t.datasets.addCase}
      wide
      onClose={()=>{if(!pending) onClose();}}
      footer={
        <>
          <Action action="cancel-case" isDisabled={pending} onPress={onClose}>
            {t.common.cancel}
          </Action>
          <Action
            primary
            isDisabled={!ready || blocked}
            isPending={pending}
            onPress={() =>
              onSave({
                ...value,
                inputs: Object.fromEntries(
                  schema.fields.map((f) => [f.name, value.inputs[f.name]]),
                ),
              })
            }
          >
            {t.common.save}
          </Action>
        </>
      }
    >
      <div className="testflow-stack">
        {extra}
        <Text
          label={t.datasets.caseName}
          value={value.name}
          onChange={(name) => setValue({ ...value, name })}
        />
        <InputBindings
          schema={schema}
          onValid={setInputValid}
          value={value.inputs}
          onChange={(inputs) => setValue({ ...value, inputs })}
        />
        <JsonEditor
          label={t.datasets.referenceJson}
          value={value.reference || {}}
          onChange={(reference) => setValue({ ...value, reference })}
          onValid={setValid}
        />
        <Check
          value={!!value.reference_confirmed}
          onChange={(reference_confirmed) =>
            setValue({ ...value, reference_confirmed })
          }
        >
          {t.common.confirmed}
        </Check>
      </div>
    </Dialog>
  );
}
