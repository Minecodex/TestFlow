import { ModuleVersion } from "../modules/version";
import { useQueries } from "@tanstack/react-query";
import { useMessages } from "../../i18n";
import type {
  GraphNode,
  Module,
  Pipeline,
  Resource,
} from "../../shared/api/types";
import { getJson } from "../../shared/api/client";
import { Action, Chips, Choice, Json, Notice, Text } from "../../shared/ui";
import { ModulePanel } from "../../shared/module-host/host";
import { RuntimeEditor } from "../modules/runtime";
import { ModuleValidation } from "../modules/validation";
export function useGraphModules(value: Pipeline) {
  const modules = value.nodes.filter((n) => n.module_id && n.module_version);
  const results = useQueries({
    queries: modules.map((n) => ({
      queryKey: ["resource", "modules", n.module_id, String(n.module_version)],
      queryFn: () =>
        getJson<Resource<Module>>(
          `/modules/${n.module_id}?version=${n.module_version}`,
        ),
    })),
  });
  return Object.fromEntries(modules.map((n, i) => [n.id, results[i].data]));
}
export function Inspector({
  node,
  graph,
  module,
  onChange,
  onRemove,
  onDisconnect,
  onSchema,
  onRemoveEdge,
}: {
  node?: GraphNode;
  graph: Pipeline;
  module?: Resource<Module>;
  onChange: (v: GraphNode) => void;
  onRemove: () => void;
  onDisconnect: () => void;
  onSchema: () => void;
  onRemoveEdge: (source:string,target:string) => void;
}) {
  const t = useMessages();
  if (!node)
    return (
      <aside className="testflow-inspector">
        <div className="testflow-stack">
          <h3>{t.pipelines.flowConfiguration}</h3>
          <dl className="testflow-definition-list">
            <div className="testflow-definition-row"><dt>{t.common.inputSchema}</dt><dd><Chips schema={graph.input_schema} /></dd></div>
            <div className="testflow-definition-row"><dt>{t.common.outputSchema}</dt><dd><Chips schema={graph.output_schema} /></dd></div>
            <div className="testflow-definition-row"><dt>{t.pipelines.nodes} / {t.pipelines.outlets}</dt><dd>{graph.nodes.length} / {graph.nodes.filter(n=>n.kind==="end").length}</dd></div>
          </dl>
          <Action size="sm" action="flow-schema" onPress={onSchema}>{t.pipelines.editGroups}</Action>
          <Notice>{t.pipelines.groupConnectionRule}</Notice>
          <h3>{t.pipelines.completeEdges}</h3>
          {graph.edges.map(edge=><div key={edge.source+"__"+edge.target} className="testflow-row testflow-between">
            <span className="testflow-small">{graph.nodes.find(n=>n.id===edge.source)?.name || edge.source} → {graph.nodes.find(n=>n.id===edge.target)?.name || edge.target}</span>
            <Action size="sm" isIconOnly variant="ghost" action="remove-edge" aria-label={t.pipelines.removeEdge} onPress={()=>onRemoveEdge(edge.source,edge.target)}>×</Action>
          </div>)}
        </div>
      </aside>
    );
  const patch = (v: Partial<GraphNode>) => onChange({ ...node, ...v });
  const incoming = graph.edges
    .filter((e) => e.target === node.id)
    .map((e) => graph.nodes.find((n) => n.id === e.source))
    .filter((n) => !!n);
  return (
    <aside className="testflow-inspector">
      <div className="testflow-stack">
        <h3>{node.name}</h3>
        <Text
          label={t.pipelines.nodeName}
          value={node.name}
          onChange={(name) => patch({ name })}
        />
        <Text
          type="number"
          label={t.pipelines.nodeTimeout}
          value={node.timeout ?? 30}
          onChange={(v) => patch({ timeout: Number(v) })}
        />
        <h3>{t.common.inputSchema}</h3>
        <Chips schema={node.input_schema} />
        <h3>{t.common.outputSchema}</h3>
        <Chips schema={node.output_schema} />
        {node.kind === "assembly" && (
          <>
            <Action action="assembly-schema" onPress={onSchema}>
              {t.common.outputSchema}
            </Action>
            <h3>{t.pipelines.mapping}</h3>
            {node.output_schema?.fields.map((field) => (
              <Choice
                key={field.name}
                label={field.name}
                value={(() => {
                  const m = node.mappings?.find((m) => m.target === field.name);
                  return m ? m.source + ":" + m.field : "";
                })()}
                options={incoming.flatMap(
                  (source) =>
                    source!.output_schema?.fields
                      .filter(
                        (f) =>
                          f.type === field.type &&
                          f.format === field.format &&
                          !!f.stream === !!field.stream,
                      )
                      .map((f) => ({
                        id: source!.id + ":" + f.name,
                        name: source!.name + " → " + f.name,
                      })) || [],
                )}
                onChange={(v) => {
                  const [source, name] = v.split(":");
                  const maps = [
                    ...(node.mappings || []).filter(
                      (m) => m.target !== field.name,
                    ),
                    { target: field.name, source, field: name },
                  ];
                  patch({
                    mappings: node
                      .output_schema!.fields.map((f) =>
                        maps.find((m) => m.target === f.name),
                      )
                      .filter((m) => !!m),
                  });
                }}
              />
            ))}
          </>
        )}
        {node.kind === "conversion" && (
          <>
            <Choice
              label={t.pipelines.conversion}
              value={node.direction || "to_full"}
              onChange={(v) => {
                const source = incoming[0]?.output_schema || graph.input_schema;
                patch({
                  direction: v as GraphNode["direction"],
                  input_schema: source,
                  output_schema: {
                    fields: source.fields.map((f) => ({
                      ...f,
                      stream: v === "to_stream" && f.type !== "JSON",
                    })),
                  },
                });
              }}
              options={[
                { id: "to_stream", name: t.pipelines.toStream },
                { id: "to_full", name: t.pipelines.toFull },
              ]}
            />
            <Action onPress={onSchema}>{t.common.inputSchema}</Action>
          </>
        )}
        {node.kind === "module" && module && (
          <>
            <ModuleVersion
              module={module}
              onSelect={(pinned) =>
                patch({
                  module_version: pinned.selected_version,
                  input_schema: pinned.data.inputs,
                  output_schema: pinned.data.outputs,
                  runtime: pinned.data.manifest.runtime,
                  parameters: pinned.data.manifest.defaults || {},
                })
              }
            />
            <h3>Kubernetes Pod</h3>
            <RuntimeEditor
              key={node.id + ":" + module.revision_id}
              value={node.runtime || module.data.manifest.runtime}
              onChange={(runtime) => patch({ runtime })}
            />
            <ModuleValidation
              key={node.id + ":" + module.revision_id}
              module={module}
              runtime={node.runtime || module.data.manifest.runtime}
            />
            <h3>{t.common.parameters}</h3>
            <ModulePanel
              key={module.revision_id}
              module={module}
              value={node.parameters || {}}
              onChange={(parameters) => patch({ parameters })}
            />
          </>
        )}
        {node.kind === "start" || node.kind === "end" ? (
          <Action action="flow-schema" onPress={onSchema}>
            {t.pipelines.schemaEdit}
          </Action>
        ) : null}
        {node.kind !== "start" && (
          <>
            <Action action="disconnect-node" onPress={onDisconnect}>
              {t.pipelines.disconnect}
            </Action>
            <Action danger action="remove-node" onPress={onRemove}>
              {t.pipelines.removeNode}
            </Action>
          </>
        )}
      </div>
    </aside>
  );
}
