import { DeleteAction } from "../../shared/ui";
import { useMessages } from "../../i18n";
import type {
  Dimension,
  Pipeline,
  Profile,
  Schema,
} from "../../shared/api/types";
import {Action, Choice, Text} from "../../shared/ui";
type Binding = Dimension["actual"];
export type BindingOverrides = Record<
  string,
  { actual?: Binding; reference?: Binding | null; evidence?: Binding[] }
>;
type BindingContext = { pipeline: Pipeline; referenceSchema?: Schema };
export function FieldBinding({
  value,
  onChange,
  label,
  fields,
  context,
}: {
  value: Binding;
  onChange: (v: Binding) => void;
  label: string;
  fields?: { id: string; name: string }[];
  context?: BindingContext;
}) {
  const t = useMessages();
  const schema =
    context &&
    (value.source === "output"
      ? context.pipeline.output_schema
      : value.source === "input"
        ? context.pipeline.input_schema
        : value.source === "reference"
          ? context.referenceSchema || context.pipeline.output_schema
          : value.source === "node"
            ? context.pipeline.nodes.find((node) => node.id === value.node_id)
                ?.output_schema
            : undefined);
  const options = schema
    ? schema.fields.map((field) => ({ id: field.name, name: field.name }))
    : value.source === "output"
      ? fields
      : undefined;
  return (
    <div className="testflow-outline testflow-stack">
      <h3>{label}</h3>
      <Choice
        label={t.evaluation.bindSource}
        value={value.source}
        options={(
          [
            "output",
            "node",
            "input",
            "execution",
            "events",
          ] as const
        ).map((id) => ({ id, name: t.evaluation.sources[id] }))}
        onChange={(source) =>
          onChange({ source: source as Binding["source"], field: "" })
        }
      />
      {value.source === "node" &&
        (context ? (
          <Choice
            label={t.evaluation.bindNode}
            value={value.node_id || ""}
            options={context.pipeline.nodes.map((node) => ({
              id: node.id,
              name: `${node.name} · ${node.id.slice(0, 8)}`,
            }))}
            onChange={(node_id) => onChange({ ...value, node_id, field: "" })}
          />
        ) : (
          <Text
            label={t.evaluation.bindNode}
            value={value.node_id || ""}
            onChange={(node_id) => onChange({ ...value, node_id })}
          />
        ))}{" "}
      {options ? (
        <Choice
          label={t.evaluation.bindField}
          value={value.field || "__all"}
          options={[{ id: "__all", name: t.common.all }, ...options]}
          onChange={(field) =>
            onChange({ ...value, field: field === "__all" ? "" : field })
          }
        />
      ) : (
        <Text
          label={t.evaluation.bindField}
          value={value.field || ""}
          onChange={(field) => onChange({ ...value, field })}
        />
      )}
    </div>
  );
}

/** Overrides are saved with the plan, independently of the reusable evaluation profile. */
export function PlanBindings({
  profile,
  pipeline,
  referenceSchema,
  value,
  onChange,
}: {
  profile: Profile;
  pipeline: Pipeline;
  referenceSchema?: Schema;
  value: BindingOverrides;
  onChange: (value: BindingOverrides) => void;
}) {
  const t = useMessages();
  const context = { pipeline, referenceSchema };
  return (
    <div className="testflow-stack">
      {profile.dimensions?.map((dimension) => {
        const override = value[dimension.id] || {};
        const patch = (changes: BindingOverrides[string]) =>
          onChange({ ...value, [dimension.id]: { ...override, ...changes } });
        const evidence = override.evidence ?? dimension.evidence ?? [];
        return (
          <div className="testflow-outline testflow-stack" key={dimension.id}>
            <h3>{dimension.name}</h3>
            <FieldBinding
              label={t.evaluation.actual}
              context={context}
              value={override.actual || dimension.actual}
              onChange={(actual) => patch({ actual })}
            />
            {(dimension.reference || dimension.needs_reference) && (
              <FieldBinding
                label={t.evaluation.reference}
                context={context}
                value={
                  override.reference ||
                  dimension.reference || { source: "reference", field: "" }
                }
                onChange={(reference) => patch({ reference })}
              />
            )}
            {evidence.map((binding, index) => (
              <div className="testflow-stack" key={index}>
                <FieldBinding
                  label={`${t.evaluation.evidence} ${index + 1}`}
                  value={binding}
                  context={context}
                  onChange={(binding) =>
                    patch({
                      evidence: evidence.map((old, i) =>
                        i === index ? binding : old,
                      ),
                    })
                  }
                />
                <DeleteAction
                  size="sm"
                  danger
                  onPress={() =>
                    patch({ evidence: evidence.filter((_, i) => i !== index) })
                  }
                >
                  {t.common.remove}
                </DeleteAction>
              </div>
            ))}
            <Action
              size="sm"
              onPress={() =>
                patch({
                  evidence: [...evidence, { source: "output", field: "" }],
                })
              }
            >
              {t.evaluation.addEvidence}
            </Action>
          </div>
        );
      })}
    </div>
  );
}
