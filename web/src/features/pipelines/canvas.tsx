import {
  Background,
  BaseEdge,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  getBezierPath,
  type Connection,
  type Node,
  type NodeChange,
  type NodeProps,
  type Edge,
  type EdgeProps,
  useReactFlow,
  useViewport,
} from "@xyflow/react";
import {
  ArrowDownToLine,
  Boxes,
  Maximize,
  Minus,
  Plus,
  Workflow,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useMessages } from "../../i18n";
import type { GraphNode, Pipeline, Schema } from "../../shared/api/types";
import { Action, Chips } from "../../shared/ui";
import "@xyflow/react/dist/style.css";
type FlowNode = Node<{ node: GraphNode; remove: (id: string) => void }, "module">;
type FlowEdge = Edge<{ remove: (source: string, target: string) => void }, "module">;
function NodeView({ data, selected }: NodeProps<FlowNode>) {
  const node = data.node;
  const { zoom } = useViewport();
  const t = useMessages();
  return (
    <div
      className={`testflow-flow-node testflow-node-${node.kind} ${selected ? "testflow-selected" : ""}`}
      style={{ "--scale": zoom } as CSSProperties}
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
        <span className="testflow-node-title" title={node.description || node.name}>{node.name}</span>
        {node.kind !== "start" && <span className="nodrag nopan testflow-node-delete"
          onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
          <Action action="remove-node" isIconOnly size="sm" variant="ghost" aria-label={`${t.pipelines.removeNode} ${node.name}`}
            onPress={() => data.remove(node.id)}><Trash2 /></Action>
        </span>}
      </div>
      <div className="testflow-node-sub">
        {node.kind === "module" ? t.modules.title : t.pipelines[node.kind]} ·{" "}
        {node.timeout ?? 30}s
      </div>
      {!!node.input_schema?.fields.length && (
        <div className="testflow-node-fields">
          <small>{t.common.input}</small>
          <Chips schema={node.input_schema} />
        </div>
      )}
      {node.kind !== "end" && !!node.output_schema?.fields.length && (
        <div className="testflow-node-fields">
          <small>{t.common.output}</small>
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
function EdgeView(props: EdgeProps<FlowEdge>) {
  const t = useMessages();
  const [path, x, y] = getBezierPath(props);
  return <>
    <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} style={props.style} interactionWidth={24} />
    <foreignObject x={x - 14} y={y - 14} width="28" height="28" overflow="visible" className="testflow-edge-delete-anchor">
      <div className="nodrag nopan testflow-edge-delete" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
        <Action action="remove-edge" isIconOnly size="sm" aria-label={t.pipelines.removeEdge}
          onPress={() => props.data?.remove(props.source, props.target)}><Trash2 /></Action>
      </div>
    </foreignObject>
  </>;
}
const edgeTypes = { module: EdgeView };
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
  onRemoveNode,
  onSave,
  onInspect,
  tools,
  library,
}: {
  value: Pipeline;
  onChange: (v: Pipeline) => void;
  selected?: string;
  onSelect: (id?: string) => void;
  onRemoveEdge: (source: string, target: string) => void;
  onDelete: () => void;
  onRemoveNode: (id: string) => void;
  onSave: () => void;
  onInspect: (id: string) => void;
  tools?: ReactNode;
  library?: ReactNode;
}) {
  const t = useMessages();
  const flow = useReactFlow();
  const previousCount = useRef(value.nodes.length);
  useEffect(() => {
    if (value.nodes.length > previousCount.current) {
      const frame = requestAnimationFrame(() => {
        void flow.fitView({ padding: 0.15 });
      });
      previousCount.current = value.nodes.length;
      return () => cancelAnimationFrame(frame);
    }
    previousCount.current = value.nodes.length;
  }, [value.nodes.length, flow]);
  const nodes: FlowNode[] = useMemo(
    () =>
      value.nodes.map((node) => ({
        id: node.id,
        type: "module",
        position: { x: node.x || 0, y: node.y || 0 },
        data: { node, remove: onRemoveNode },
        selected: node.id === selected,
      })),
    [value.nodes, selected, onRemoveNode],
  );
  const edges = value.edges.map((e) => ({
    id: e.source + "::" + e.target,
    type: "module",
    source: e.source,
    target: e.target,
    sourceHandle: "output",
    targetHandle: "input",
    markerEnd: { type: MarkerType.ArrowClosed },
    className: "testflow-flow-edge",
    data: { remove: onRemoveEdge },
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
        if (target.closest("input,textarea,button,[role=combobox]")) return;
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
        edgeTypes={edgeTypes}
        onNodesChange={changeNodes}
        onConnect={connect}
        isValidConnection={isValid}
        onNodeClick={(_, n) => onInspect(n.id)}
        onPaneClick={() => onSelect(undefined)}
        fitView
        minZoom={0.25}
        maxZoom={1.65}
        deleteKeyCode={null}
        aria-label={t.pipelines.title}
      >
        <Background gap={18} size={1} />
      </ReactFlow>
      <div className="testflow-canvas-tools">{tools}</div>
      {library && <div className="testflow-canvas-library">{library}</div>}
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
