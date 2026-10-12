import {
  Background,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  type Connection,
  type Node,
  type NodeChange,
  type NodeProps,
  useReactFlow,
} from "@xyflow/react";
import {
  ArrowDownToLine,
  Boxes,
  Maximize,
  Minus,
  Plus,
  Workflow,
} from "lucide-react";
import { useEffect, useMemo, type CSSProperties } from "react";
import { useMessages } from "../../i18n";
import type { GraphNode, Pipeline, Schema } from "../../shared/api/types";
import { Action, Chips } from "../../shared/ui";
import "@xyflow/react/dist/style.css";
type FlowNode = Node<{ node: GraphNode }, "module">;
function NodeView({ data, selected }: NodeProps<FlowNode>) {
  const node = data.node;
  const t = useMessages();
  return (
    <div
      className={`testflow-flow-node testflow-node-${node.kind} ${selected ? "testflow-selected" : ""}`}
    >
      {node.kind !== "start" && (
        <Handle type="target" position={Position.Left} id="input" />
      )}
      <div className="testflow-node-head">
        <span className="testflow-module-icon">
          {node.kind === "end" ? (
            <ArrowDownToLine />
          ) : node.kind === "module" ? (
            <Boxes />
          ) : (
            <Workflow />
          )}
        </span>
        {node.name}
      </div>
      <div className="testflow-node-sub">
        {node.kind === "module" ? t.modules.title : t.pipelines[node.kind]} ·{" "}
        {node.timeout ?? 30}s
      </div>
      {!!node.input_schema?.fields.length && (
        <div className="testflow-node-fields">
          <small>IN</small>
          <Chips schema={node.input_schema} />
        </div>
      )}
      {node.kind!=="end" && !!node.output_schema?.fields.length && (
        <div className="testflow-node-fields">
          <small>OUT</small>
          <Chips schema={node.output_schema} />
        </div>
      )}
      {node.kind !== "end" && (
        <Handle type="source" position={Position.Right} id="output" />
      )}
    </div>
  );
}
const nodeTypes = { module: NodeView };
const matching = (a?: Schema | null, b?: Schema | null) =>
  JSON.stringify(a?.fields.map((f) => ({ ...f, stream: !!f.stream }))) ===
  JSON.stringify(b?.fields.map((f) => ({ ...f, stream: !!f.stream })));
function Surface({
  value,
  onChange,
  selected,
  onSelect,
  onRemoveEdge,
  onDelete,
  onSave,
}: {
  value: Pipeline;
  onChange: (v: Pipeline) => void;
  selected?: string;
  onSelect: (id?: string) => void;
  onRemoveEdge: (source: string, target: string) => void;
  onDelete: () => void;
  onSave: () => void;
}) {
  const t = useMessages();
  const flow = useReactFlow();
  const nodes: FlowNode[] = useMemo(
    () =>
      value.nodes.map((node) => ({
        id: node.id,
        type: "module",
        position: { x: node.x || 0, y: node.y || 0 },
        data: { node },
        selected: node.id === selected,
      })),
    [value.nodes, selected],
  );
  const edges = value.edges.map((e) => ({
    id: e.source + "__" + e.target,
    source: e.source,
    target: e.target,
    sourceHandle: "output",
    targetHandle: "input",
    markerEnd: { type: MarkerType.ArrowClosed },
    className: "testflow-flow-edge",
  }));
  const connect = (connection: Connection) => {
    if (!connection.source || !connection.target) return;
    onChange({
      ...value,
      edges: [
        ...value.edges,
        { source: connection.source, target: connection.target },
      ],
    });
  };
  const isValid = (
    connection: Connection | { source: string; target: string },
  ) => {
    const a = value.nodes.find((n) => n.id === connection.source),
      b = value.nodes.find((n) => n.id === connection.target);
    if (!a || !b || a.id === b.id || a.kind === "end" || b.kind === "start")
      return false;
    if (value.edges.some((e) => e.source === a.id && e.target === b.id))
      return false;
    if (b.kind !== "assembly" && value.edges.some((e) => e.target === b.id))
      return false;
    const seen = new Set<string>();
    const reachable = [b.id];
    while (reachable.length) {
      const node = reachable.pop()!;
      if (node === a.id) return false;
      if (seen.has(node)) continue;
      seen.add(node);
      reachable.push(
        ...value.edges.filter((e) => e.source === node).map((e) => e.target),
      );
    }
    return b.kind === "assembly" || matching(a.output_schema, b.input_schema);
  };
  const changeNodes = (changes: NodeChange<FlowNode>[]) => {
    const updated = applyNodeChanges(changes, nodes);
    if (changes.some((c) => c.type === "position"))
      onChange({
        ...value,
        nodes: value.nodes.map((n) => {
          const updatedNode = updated.find((v) => v.id === n.id);
          return updatedNode
            ? { ...n, x: updatedNode.position.x, y: updatedNode.position.y }
            : n;
        }),
      });
    const selection = changes.find((c) => c.type === "select" && c.selected);
    if (selection && selection.type === "select") onSelect(selection.id);
  };
  return (
    <div
      className="testflow-canvas"
      tabIndex={0}
      aria-label={t.pipelines.title}
      onKeyDown={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest("input,textarea,[role=combobox]")) return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          onSave();
        } else if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          onDelete();
        } else if (e.key === "Escape") onSelect(undefined);
      }}
    >
      <ReactFlow
        proOptions={{ hideAttribution: true }}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={changeNodes}
        onConnect={connect}
        isValidConnection={isValid}
        onNodeClick={(_, n) => onSelect(n.id)}
        onPaneClick={() => onSelect(undefined)}
        onEdgeClick={(_, edge) => onRemoveEdge(edge.source, edge.target)}
        fitView
        minZoom={0.25}
        maxZoom={1.65}
        deleteKeyCode={null}
        aria-label={t.pipelines.title}
      >
        <Background gap={18} size={1} />
      </ReactFlow>
      <div className="testflow-canvas-controls">
        <Action
          size="sm"
          isIconOnly
          action="zoom-out"
          aria-label={t.pipelines.zoomOut}
          onPress={() => {
            void flow.zoomOut();
          }}
        >
          <Minus />
        </Action>
        <Action
          size="sm"
          isIconOnly
          action="zoom-in"
          aria-label={t.pipelines.zoomIn}
          onPress={() => {
            void flow.zoomIn();
          }}
        >
          <Plus />
        </Action>
        <Action
          size="sm"
          isIconOnly
          action="fit-canvas"
          aria-label={t.pipelines.fit}
          onPress={() => {
            void flow.fitView({ padding: 0.15 });
          }}
        >
          <Maximize />
        </Action>
      </div>
    </div>
  );
}
export function Canvas(props: Parameters<typeof Surface>[0]) {
  return (
    <ReactFlowProvider>
      <Surface {...props} />
    </ReactFlowProvider>
  );
}
