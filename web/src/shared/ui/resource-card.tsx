import type { ReactNode } from "react";
import { Action, Badge } from ".";
import { useMessages } from "../../i18n";

/** Shared resource hierarchy follows the prototype: identity, summary, contracts, then actions. */
export function ResourceCard({ icon, title, version, summary, children, actions, className = "", onVersion }: {
  icon: ReactNode;
  title: string;
  version: number;
  summary?: ReactNode;
  children: ReactNode;
  actions: ReactNode;
  className?: string;
  onVersion?: () => void;
}) {
  const t = useMessages();
  return <article className={`testflow-card testflow-resource-card ${className}`}>
    <div className="testflow-row testflow-between testflow-mb">
      <span className="testflow-resource-icon">{icon}</span>
      <Badge>{onVersion ? <Action aria-label={t.common.versions} className="testflow-resource-version" onPress={onVersion}>v{version}</Action> : <>v{version}</>}</Badge>
    </div>
    <h3 className="testflow-resource-title">{title}</h3>
    {summary && <p className="testflow-resource-description">{summary}</p>}
    {children}
    <div className="testflow-resource-actions">{actions}</div>
  </article>;
}
