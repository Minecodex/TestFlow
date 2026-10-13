import type { PortField } from "../../shared/api/types";
import { Badge, Json } from "../../shared/ui";
import { useMessages } from "../../i18n";
import { AssetReference } from "./references";
export { AssetMedia } from "./player";
export function ValueMedia({
  value,
  field,
  framed = false,
  showStatus = true,
  compact = false,
}: {
  value: unknown;
  field: PortField;
  framed?: boolean;
  showStatus?: boolean;
  compact?: boolean;
}) {
  const t = useMessages();
  if (field.type === "JSON") return <Json value={value} />;
  if (typeof value === "string")
    return <p className="testflow-output-content">{value}</p>;
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    const media =
      v.asset_id ? (
        <AssetReference
          id={String(v.asset_id)}
          version={v.asset_version ? String(v.asset_version) : undefined}
          compact={compact}
          framed={framed}
        />
      ) : null;
    if (field.stream && v.stream)
      return (
        <div className="testflow-stack">
          {showStatus && <div><Badge state={v.eos ? "succeeded" : "failed"}>
            {v.eos ? t.assets.streamComplete : t.assets.streamIncomplete}
          </Badge></div>}
          {media ||
            (field.type === "Text" && v.text != null ? (
              <p className="testflow-output-content">{String(v.text)}</p>
            ) : (
              <Json value={value} />
            ))}
        </div>
      );
    if (media) return media;
  }
  return <Json value={value} />;
}
