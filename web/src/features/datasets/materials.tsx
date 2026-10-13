import type { Case, Schema } from "../../shared/api/types";
import { useMessages } from "../../i18n";
import { Badge, DataTable, DeleteAction, EditAction, Empty, Json } from "../../shared/ui";
import { AssetReference } from "../assets/references";
import { MaterialLabel } from "../assets/material-label";

export function InputGroups({ cases, schema, onEdit, onRemove, pending = false }: {
  cases: Case[]; schema: Schema; onEdit?: (value: Case) => void;
  onRemove?: (value: Case) => void; pending?: boolean;
}) {
  const t = useMessages();
  if (!cases.length) return <Empty text={t.datasets.noCases} />;
  return <div className="testflow-input-groups">
    {cases.map(value => <section className="testflow-input-group" key={value.id} data-case-id={value.id}>
      <header className="testflow-row testflow-between">
        <strong>{value.name}</strong>
        <div className="testflow-row">
          <Badge>{schema.fields.length} {t.datasets.inputFields}</Badge>
          {onEdit && <EditAction action="edit-case" onPress={() => onEdit(value)} />}
          {onRemove && <DeleteAction action="remove-case" isPending={pending} onPress={() => onRemove(value)} />}
        </div>
      </header>
      <DataTable className="testflow-input-group-table" label={`${value.name} · ${t.datasets.cases}`}
        headers={[t.assets.assetColumn, t.assets.preview, t.assets.content, t.assets.categoryTags]}
        rows={schema.fields.map((field, index) => {
          const binding = value.inputs[field.name];
          return { id: field.name, cells: [
            <div className="testflow-input-group-identity" data-field={field.name}>
              <MaterialLabel field={field} index={index} />
              {binding?.asset_id ? <AssetReference id={binding.asset_id} section="identity" /> : <span className="testflow-row-subtitle">{t.datasets.literal}</span>}
            </div>,
            binding?.asset_id ? <AssetReference id={binding.asset_id} section="media" /> : <Badge>{t.common.types[field.type]} · {field.format}</Badge>,
            binding?.asset_id ? <AssetReference id={binding.asset_id} section="content" /> : field.type === "JSON" ? <Json value={binding?.value} /> : <p className="testflow-preview-text">{String(binding?.value ?? "")}</p>,
            binding?.asset_id ? <AssetReference id={binding.asset_id} section="metadata" /> : <span className="testflow-muted">—</span>,
          ] };
        })} />
    </section>)}
  </div>;
}
