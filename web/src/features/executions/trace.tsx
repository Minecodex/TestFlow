import type { CSSProperties } from "react";
import { useMessages } from "../../i18n";
import type { Execution } from "../../shared/api/types";
import { Action, Status } from "../../shared/ui";
export function TraceTimeline({
  execution,
  selected,
  span,
  onSelect,
}: {
  execution: Execution;
  selected: string;
  span: string | null;
  onSelect: (node: string, span?: string) => void;
}) {
  const t = useMessages();
  const graph = execution.snapshot.pipeline as {
    graph: { nodes: { id: string }[] };
  };
  const duration = Math.max(
    1,
    execution.duration_ms || 0,
    ...Object.values(execution.nodes).map(
      (n) => (Number(n.started_ms) || 0) + (Number(n.duration_ms) || 0),
    ),
  );
  return (
    <div className="testflow-timeline">
      {graph.graph.nodes
        .map((entry) => execution.nodes[entry.id])
        .filter(Boolean)
        .map((node) => {
          const events = (execution.events || []).filter(
            (e) => e.kind === "trace.internal" && e.node_id === node.id,
          );
          const byId = new Map(events.map((e) => [String(e.data.span_id), e]));
          const depth = (parent: string, seen = new Set<string>()): number => {
            if (seen.has(parent) || !byId.has(parent)) return 0;
            seen.add(parent);
            return (
              1 + depth(String(byId.get(parent)!.data.parent_span_id), seen)
            );
          };
          const offset = Math.min(
            100,
            (Math.max(0, Number(node.started_ms) || 0) / duration) * 100,
          );
          const width = Math.min(
            100 - offset,
            Math.max(0.5, ((Number(node.duration_ms) || 0) / duration) * 100),
          );
          return (
            <div key={node.id}>
              <Action
                action="trace-node"
                className={`testflow-trace-item ${selected === node.id && !span ? "active" : ""}`}
                aria-pressed={selected === node.id && !span}
                onPress={() => onSelect(node.id)}
              >
                <div className="testflow-row testflow-between">
                  <strong>{node.name}</strong>
                  <span className="testflow-tiny">
                    {node.duration_ms?.toFixed(1) || "—"} ms
                  </span>
                </div>
                <Status value={node.state} />
                <div className="testflow-trace-bar">
                  <span style={{ left: offset + "%", width: width + "%" }} />
                </div>
              </Action>
              {events.map((event) => (
                <Action
                  key={event.id}
                  action="trace-span"
                  className={`testflow-trace-item sub ${span === String(event.data.span_id) ? "active" : ""}`}
                  aria-pressed={span === String(event.data.span_id)}
                  style={
                    {
                      "--testflow-span-depth": depth(
                        String(event.data.parent_span_id),
                      ),
                    } as CSSProperties
                  }
                  onPress={() => onSelect(node.id, String(event.data.span_id))}
                >
                  <span>
                    {"↳ ".repeat(depth(String(event.data.parent_span_id)) + 1)}
                    {String(event.data.name || event.data.span_id)}
                  </span>
                  <span className="testflow-tiny">
                    {typeof event.data.duration_ms === "number"
                      ? event.data.duration_ms.toFixed(1) + " ms"
                      : t.common.details}
                  </span>
                </Action>
              ))}
            </div>
          );
        })}
    </div>
  );
}
