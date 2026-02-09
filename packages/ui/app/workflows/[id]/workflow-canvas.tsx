"use client";

import { useCallback, useEffect, useMemo } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type Connection,
  type Node,
  type Edge,
  type NodeProps,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { User, LogIn, LogOut } from "lucide-react";
import { CanvasNodeCard } from "../../components/canvas-node-card";

type Agent = { id: string; name: string };

type WfNode = { id: string; type: string; position: [number, number]; parameters?: Record<string, unknown> };
type WfEdge = { id: string; source: string; target: string };

type FlowNodeData = {
  nodeType: "agent" | "input" | "output";
  agentId?: string;
  agentName?: string;
  agents: Agent[];
  parameters?: Record<string, unknown>;
  onAgentChange?: (nodeId: string, agentId: string) => void;
  onConfigChange?: (nodeId: string, params: Record<string, unknown>) => void;
  onRemove: (nodeId: string) => void;
};

const DRAG_TYPE_AGENT = "application/agent-node";
const DRAG_TYPE_IO = "application/workflow-io-node";

function AgentNode({ id, data, selected }: NodeProps<Node<FlowNodeData>>) {
  const agents = data.agents ?? [];
  const agentId = (data.agentId as string) ?? "";
  const onChange = (val: string) => data.onAgentChange?.(id, val);
  return (
    <CanvasNodeCard
      icon={<User size={14} style={{ color: "var(--text-muted)" }} />}
      label="Agent"
      selected={selected}
      onRemove={() => data.onRemove?.(id)}
      minWidth={160}
    >
      <select
        className="select nodrag nopan"
        value={agentId}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", fontSize: "0.85rem" }}
      >
        <option value="">Select agent</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </select>
    </CanvasNodeCard>
  );
}

function InputNode({ id, data, selected }: NodeProps<Node<FlowNodeData>>) {
  const params = data.parameters ?? {};
  const transform = (params.transform as { expression?: string }) ?? {};
  const expression = String(transform.expression ?? "").trim();
  return (
    <CanvasNodeCard
      icon={<LogIn size={14} style={{ color: "var(--primary)" }} />}
      label="Input"
      selected={selected}
      onRemove={() => data.onRemove?.(id)}
      handleTop={false}
      minWidth={160}
      maxWidth={260}
    >
      <textarea
        className="nodrag nopan textarea"
        value={expression}
        onChange={(e) => data.onConfigChange?.(id, { ...params, transform: { expression: e.target.value } })}
        placeholder='{{ $input }} or custom transform'
        rows={2}
        style={{ fontSize: "0.75rem", resize: "vertical", width: "100%", minHeight: 40 }}
      />
    </CanvasNodeCard>
  );
}

function OutputNode({ id, data, selected }: NodeProps<Node<FlowNodeData>>) {
  const params = data.parameters ?? {};
  const transform = (params.transform as { expression?: string }) ?? {};
  const expression = String(transform.expression ?? "").trim();
  return (
    <CanvasNodeCard
      icon={<LogOut size={14} style={{ color: "var(--primary)" }} />}
      label="Output"
      selected={selected}
      onRemove={() => data.onRemove?.(id)}
      handleBottom={false}
      minWidth={160}
      maxWidth={260}
    >
      <textarea
        className="nodrag nopan textarea"
        value={expression}
        onChange={(e) => data.onConfigChange?.(id, { ...params, transform: { expression: e.target.value } })}
        placeholder='{{ $input }} or custom transform'
        rows={2}
        style={{ fontSize: "0.75rem", resize: "vertical", width: "100%", minHeight: 40 }}
      />
    </CanvasNodeCard>
  );
}

const nodeTypes = { agent: AgentNode, input: InputNode, output: OutputNode };

function toFlowNodes(
  wfNodes: WfNode[],
  agents: Agent[],
  onAgentChange: (nodeId: string, agentId: string) => void,
  onConfigChange: (nodeId: string, params: Record<string, unknown>) => void,
  onRemove: (nodeId: string) => void
): Node<FlowNodeData>[] {
  return wfNodes.map((n, i) => {
    const pos = Array.isArray(n.position) ? { x: n.position[0], y: n.position[1] } : { x: 80 + (i % 3) * 220, y: 60 + Math.floor(i / 3) * 120 };
    const params = n.parameters ?? {};
    const agentId = (params.agentId as string) ?? "";
    const agent = agents.find((a) => a.id === agentId);
    const nodeType = (["agent", "input", "output"].includes(n.type) ? n.type : "agent") as FlowNodeData["nodeType"];
    return {
      id: n.id,
      type: nodeType,
      position: pos,
      data: {
        nodeType,
        agentId,
        agentName: agent?.name ?? "Agent",
        agents,
        parameters: params,
        onAgentChange,
        onConfigChange,
        onRemove,
      },
    };
  });
}

function toFlowEdges(wfEdges: WfEdge[]): Edge[] {
  return wfEdges.map((e) => ({ id: e.id, source: e.source, target: e.target }));
}

/** Emit n8n-style canvas format (position: [x,y], parameters; edges with source/target). */
function fromFlowNodes(nodes: Node<FlowNodeData>[]): WfNode[] {
  return nodes.map((n) => ({
    id: n.id,
    type: n.data?.nodeType ?? "agent",
    position: [n.position?.x ?? 0, n.position?.y ?? 0],
    parameters: n.data?.nodeType === "agent"
      ? { ...(n.data?.parameters ?? {}), agentId: n.data?.agentId }
      : n.data?.parameters ?? {},
  }));
}

function fromFlowEdges(edges: Edge[]): WfEdge[] {
  return edges.map((e) => ({
    id: e.id ?? `e-${e.source}-${e.target}`,
    source: e.source,
    target: e.target,
  }));
}

type Props = {
  wfNodes: WfNode[];
  wfEdges: WfEdge[];
  agents: Agent[];
  onNodesEdgesChange: (nodes: WfNode[], edges: WfEdge[]) => void;
  onAddNode: () => void;
  onAddNodeAt?: (position: { x: number; y: number }, agentId?: string, nodeType?: "agent" | "input" | "output") => void;
};

function WorkflowCanvasInner({ wfNodes, wfEdges, agents, onNodesEdgesChange, onAddNode, onAddNodeAt }: Props) {
  const { screenToFlowPosition } = useReactFlow();

  const onAgentChange = useCallback(
    (nodeId: string, agentId: string) => {
      const next = wfNodes.map((n) =>
        n.id === nodeId ? { ...n, parameters: { ...(n.parameters ?? {}), agentId } } : n
      );
      onNodesEdgesChange(next, wfEdges);
    },
    [wfNodes, wfEdges, onNodesEdgesChange]
  );

  const onConfigChange = useCallback(
    (nodeId: string, params: Record<string, unknown>) => {
      const next = wfNodes.map((n) =>
        n.id === nodeId ? { ...n, parameters: params } : n
      );
      onNodesEdgesChange(next, wfEdges);
    },
    [wfNodes, wfEdges, onNodesEdgesChange]
  );

  const onRemove = useCallback(
    (nodeId: string) => {
      const nextNodes = wfNodes.filter((n) => n.id !== nodeId);
      const nextEdges = wfEdges.filter((e) => e.source !== nodeId && e.target !== nodeId);
      onNodesEdgesChange(nextNodes, nextEdges);
    },
    [wfNodes, wfEdges, onNodesEdgesChange]
  );

  const initialNodes = useMemo(
    () => toFlowNodes(wfNodes, agents, onAgentChange, onConfigChange, onRemove),
    [wfNodes, agents, onAgentChange, onConfigChange, onRemove]
  );
  const initialEdges = useMemo(() => toFlowEdges(wfEdges), [wfEdges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(toFlowNodes(wfNodes, agents, onAgentChange, onConfigChange, onRemove));
    setEdges(toFlowEdges(wfEdges));
  }, [wfNodes.length, wfEdges.length, JSON.stringify(wfNodes.map((n) => [n.id, n.type, n.parameters ?? n.config, n.position])), JSON.stringify(wfEdges.map((e) => [e.id, e.source ?? e.from, e.target ?? e.to]))]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge(connection, eds));
      const newEdge: WfEdge = {
        id: `e-${connection.source}-${connection.target}`,
        source: connection.source ?? "",
        target: connection.target ?? "",
      };
      onNodesEdgesChange(wfNodes, [...wfEdges, newEdge]);
    },
    [wfNodes, wfEdges, onNodesEdgesChange]
  );

  const onNodesChangeInternal = useCallback(
    (changes: NodeChange<Node<FlowNodeData>>[]) => {
      setNodes((nds) => {
        const next = applyNodeChanges(changes, nds);
        queueMicrotask(() => onNodesEdgesChange(fromFlowNodes(next), wfEdges));
        return next;
      });
    },
    [wfEdges, onNodesEdgesChange]
  );

  const onEdgesChangeInternal = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      setEdges((eds) => {
        const next = applyEdgeChanges(changes, eds);
        queueMicrotask(() => onNodesEdgesChange(wfNodes, fromFlowEdges(next)));
        return next;
      });
    },
    [wfNodes, onNodesEdgesChange]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData(DRAG_TYPE_AGENT) || e.dataTransfer.getData(DRAG_TYPE_IO);
      if (!raw || !onAddNodeAt) return;
      try {
        const parsed = JSON.parse(raw) as { agentId?: string; type?: "agent" | "input" | "output" };
        const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        onAddNodeAt(position, parsed.agentId, parsed.type ?? "agent");
      } catch {
        // ignore
      }
    },
    [screenToFlowPosition, onAddNodeAt]
  );

  const edgeOptions = useMemo(
    () => ({
      type: "smoothstep" as const,
      style: { stroke: "var(--primary)", strokeWidth: 2 },
      animated: true,
    }),
    []
  );

  return (
    <div className="canvas-wrap">
      <div
        style={{
          width: 160,
          flexShrink: 0,
          borderRight: "1px solid var(--border)",
          padding: "0.5rem",
          background: "var(--surface)",
          display: "flex",
          flexDirection: "column",
          gap: "0.35rem",
        }}
      >
        <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>Agents</span>
        <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-muted)" }}>
          Drag onto canvas to add. Connect from bottom handle to another&apos;s top.
        </p>
        {agents.length === 0 ? (
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>No agents</span>
        ) : (
          agents.map((a) => (
            <div
              key={a.id}
              draggable
              onDragStart={(ev) => ev.dataTransfer.setData(DRAG_TYPE_AGENT, JSON.stringify({ agentId: a.id }))}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.35rem",
                padding: "0.4rem 0.5rem",
                borderRadius: 6,
                background: "var(--background)",
                border: "1px solid var(--border)",
                cursor: "grab",
                fontSize: "0.85rem",
              }}
            >
              <User size={14} style={{ color: "var(--text-muted)" }} />
              {a.name}
            </div>
          ))
        )}
        <button type="button" className="button" onClick={onAddNode} style={{ fontSize: "0.85rem", marginTop: "0.25rem" }}>
          + Add agent
        </button>
        <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", marginTop: "0.5rem" }}>I/O</span>
        {(["input", "output"] as const).map((t) => (
          <div
            key={t}
            draggable
            onDragStart={(ev) => ev.dataTransfer.setData(DRAG_TYPE_IO, JSON.stringify({ type: t }))}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.35rem",
              padding: "0.4rem 0.5rem",
              borderRadius: 6,
              background: "var(--background)",
              border: "1px solid var(--border)",
              cursor: "grab",
              fontSize: "0.85rem",
            }}
          >
            {t === "input" && <LogIn size={14} />}
            {t === "output" && <LogOut size={14} />}
            {t}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, minWidth: 0, height: "100%" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChangeInternal}
          onEdgesChange={onEdgesChangeInternal}
          onConnect={onConnect}
          onDrop={onDrop}
          onDragOver={onDragOver}
          nodeTypes={nodeTypes}
          nodesDraggable
          nodesConnectable
          elementsSelectable
          fitView
          fitViewOptions={{ padding: 0.2 }}
          defaultEdgeOptions={edgeOptions}
          connectionLineStyle={{ stroke: "var(--primary)", strokeWidth: 2 }}
        >
          <Background />
          <Controls position="bottom-right" showZoom showFitView showInteractive />
        </ReactFlow>
      </div>
    </div>
  );
}

export default function WorkflowCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
