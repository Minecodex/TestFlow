import { useQueries } from "@tanstack/react-query";
import { useMessages } from "../../i18n";
import type {
  GraphNode,
  Module,
  Pipeline,
  Resource,
  Schema,
} from "../../shared/api/types";
import { getJson } from "../../shared/api/client";
import {Action, Choice, Notice, SchemaEditor, Text} from "../../shared/ui";
import { ModulePanel } from "../../shared/module-host/host";
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
  onSchema,
  onContractChange,
}: {
  node: GraphNode;
  graph: Pipeline;
  module?: Resource<Module>;
  onChange: (v: GraphNode) => void;
  onSchema: () => void;
  onContractChange: (kind: "start" | "end", schema: Schema) => void;
}) {
  const t = useMessages();
  const patch = (v: Partial<GraphNode>) => onChange({ ...node, ...v });
  const incoming = graph.edges
    .filter((e) => e.target === node.id)
    .map((e) => graph.nodes.find((n) => n.id === e.source))
    .filter((n) => !!n);
  return (
    <div className="testflow-node-settings">
      <div className="testflow-stack">
        <Text
          label={t.pipelines.nodeName}
          value={node.name}
          onChange={(name) => patch({ name })}
        />
        <Text label={t.pipelines.nodeDescription} value={node.description || ""}
          multiline onChange={(description) => patch({ description })} />
        {node.kind === "start" ? (
          <>
            <h3>{t.common.inputSchema}</h3>
            <SchemaEditor
              value={graph.input_schema}
              onChange={(schema) => onContractChange("start", schema)}
            />
          </>
        ) : node.kind === "end" ? (
          <>
            <h3>{t.common.outputSchema}</h3>
            <SchemaEditor
              value={graph.output_schema}
              onChange={(schema) => onContractChange("end", schema)}
            />
            <Notice>{t.pipelines.sharedOutputHint}</Notice>
          </>
        ) : null}
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
            <h3>{t.modules.businessParameters}</h3>
            <ModulePanel
              key={module.revision_id}
              module={module}
              value={node.parameters || {}}
              onChange={(parameters) => patch({ parameters })}
            />
          </>
        )}
      </div>
    </div>
  );
}
