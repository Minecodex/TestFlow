import type { PortField } from "../../shared/api/types";
import { useMessages } from "../../i18n";

export function MaterialLabel({ field, index }: { field: PortField; index: number }) {
  const t = useMessages();
  return <div className="testflow-material-label" data-field-position={index + 1}>
    <span className="testflow-material-number">{index + 1}</span>
    <span>{field.name}</span>
    <small className="testflow-muted">{t.common.types[field.type]}</small>
  </div>;
}
