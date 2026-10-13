import { useMessages } from "../../i18n";
import { useResource } from "../../shared/api/hooks";
import type { Asset } from "../../shared/api/types";
import { Failure } from "../../shared/ui";
import { AssetMedia } from "./player";

export type AssetSection = "identity" | "media" | "preview" | "content" | "metadata" | "all";
export function AssetReference({ id, version, section = "preview", compact = true, framed = false }: {
  id: string; version?: string; section?: AssetSection; compact?: boolean; framed?: boolean;
}) {
  const t = useMessages();
  const query = useResource<Asset>("assets", id, version);
  const latest = useResource<Asset>("assets", id);
  const asset = query.data;
  if (!asset) return query.error ? <Failure error={query.error} /> : <span className="testflow-tiny testflow-muted" role="status">{t.common.loading}</span>;
  const href = `/assets/${id}?q=${encodeURIComponent(latest.data?.name || asset.name)}`;
  return <div className={`testflow-asset-reference testflow-asset-reference-${section}`} data-asset-id={id} data-asset-version={asset.selected_version}>
    {(section === "identity" || section === "all") && <div>
      <a className="testflow-cell-title testflow-asset-source-name" href={href} target="_blank" rel="noopener noreferrer">{asset.name}</a>
      <div className="testflow-row-subtitle">{t.common.types[asset.data.type]} · {asset.data.format}</div>
    </div>}
    {section === "media" && <AssetMedia asset={asset} compact={compact} framed={framed} />}
    {(section === "preview" || section === "all") && <>
      {asset.data.type === "Text" ? <a className="testflow-preview-text testflow-media-open" href={href} target="_blank" rel="noopener noreferrer">{asset.data.text}</a> : <AssetMedia asset={asset} compact={compact} framed={framed} />}
      {section !== "all" && <a className="testflow-tiny testflow-muted testflow-asset-source-name" href={href} target="_blank" rel="noopener noreferrer">{asset.name}</a>}
    </>}
    {section === "content" && <a className="testflow-media-open testflow-material-summary" href={href} target="_blank" rel="noopener noreferrer">{asset.data.text || t.assets.noReference}</a>}
    {(section === "metadata" || section === "all") && <div className="testflow-asset-metadata">
      <span className="testflow-asset-category">{asset.data.category || "—"}</span>
      <span className="testflow-chips">{asset.data.tags?.map(tag => <span className="testflow-tag" key={tag}>{tag}</span>)}</span>
    </div>}
  </div>;
}
