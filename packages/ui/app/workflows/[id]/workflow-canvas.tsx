"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { User, LayoutGrid, X } from "lucide-react";
import { CanvasNodeCard } from "../../components/canvas-node-card";
import { CanvasLabelEdge } from "../../components/canvas-label-edge";
import { getGridPosition, getWorkflowGridOptions, layoutNodesWithoutOverlap } from "../../lib/canvas-layout";

type Agent = { id: string; name: string };

type WfNode = { id: string; type: string; position: [number, number]; parameters?: Record<string, unknown> };
export type WfEdge = { id: string; source: string; target: string; data?: { label?: string } };

type FlowNodeData = {
  nodeType: "agent";
  agentId?: string;
  agentName?: string;
  agents: Agent[];
  parameters?: Record<string, unknown>;
  onAgentChange?: (nodeId: string, agentId: string) => void;
  onRemove: (nodeId: string) => void;
};

const DRAG_TYPE_AGENT = "application/agent-node";

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

const nodeTypes = { agent: AgentNode };

function toFlowNodes(
  wfNodes: WfNode[],
  agents: Agent[],
  onAgentChange: (nodeId: string, agentId: string) => void,
  onRemove: (nodeId: string) => void
): Node<FlowNodeData>[] {
  const gridOpts = getWorkflowGridOptions();
  return wfNodes.map((n, i) => {
    const pos = Array.isArray(n.position) && n.position.length >= 2 && Number.isFinite(n.position[0]) && Number.isFinite(n.position[1])
      ? { x: n.position[0], y: n.position[1] }
      : getGridPosition(i, gridOpts);
    const params = n.parameters ?? {};
    const agentId = (params.agentId as string) ?? "";
    const agent = agents.find((a) => a.id === agentId);
    return {
      id: n.id,
      type: "agent",
      position: pos,
      dragHandle: ".drag-handle",
      data: {
        nodeType: "agent",
        agentId,
        agentName: agent?.name ?? "Agent",
        agents,
        parameters: params,
        onAgentChange,
        onRemove,
      },
    };
  });
}

function toFlowEdges(wfEdges: WfEdge[]): Edge[] {
  return wfEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: "labelEdge",
    data: { label: e.data?.label ?? "" },
  }));
}

/** Emit n8n-style canvas format (position: [x,y], parameters; edges with source/target). */
function fromFlowNodes(nodes: Node<FlowNodeData>[]): WfNode[] {
  return nodes.map((n) => ({
    id: n.id,
    type: "agent",
    position: [n.position?.x ?? 0, n.position?.y ?? 0],
    parameters: { ...(n.data?.parameters ?? {}), agentId: n.data?.agentId },
  }));
}

function fromFlowEdges(edges: Edge[]): WfEdge[] {
  return edges.map((e) => ({
    id: e.id ?? `e-${e.source}-${e.target}`,
    source: e.source,
    target: e.target,
    data: e.data && typeof e.data === "object" && "label" in e.data
      ? { label: typeof (e.data as { label?: unknown }).label === "string" ? (e.data as { label: string }).label : undefined }
      : undefined,
  }));
}

type Props = {
  wfNodes: WfNode[];
  wfEdges: WfEdge[];
  agents: Agent[];
  onNodesEdgesChange: (nodes: WfNode[], edges: WfEdge[]) => void;
  onAddNode: () => void;
  onAddNodeAt?: (position: { x: number; y: number }, agentId?: string) => void;
};

function WorkflowCanvasInner({ wfNodes, wfEdges, agents, onNodesEdgesChange, onAddNode, onAddNodeAt }: Props) {
  const { screenToFlowPosition } = useReactFlow();
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const onAgentChange = useCallback(
    (nodeId: string, agentId: string) => {
      const next = wfNodes.map((n) =>
        n.id === nodeId ? { ...n, parameters: { ...(n.parameters ?? {}), agentId } } : n
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
    () => toFlowNodes(wfNodes, agents, onAgentChange, onRemove),
    [wfNodes, agents, onAgentChange, onRemove]
  );
  const initialEdges = useMemo(() => toFlowEdges(wfEdges), [wfEdges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(toFlowNodes(wfNodes, agents, onAgentChange, onRemove));
    setEdges(toFlowEdges(wfEdges));
  }, [wfNodes.length, wfEdges.length, JSON.stringify(wfNodes.map((n) => [n.id, n.type, n.parameters, n.position])), JSON.stringify(wfEdges.map((e) => [e.id, e.source, e.target, e.data]))]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge(connection, eds));
      const newEdge: WfEdge = {
        id: `e-${connection.source}-${connection.target}`,
        source: connection.source ?? "",
        target: connection.target ?? "",
        data: {},
      };
      onNodesEdgesChange(wfNodes, [...wfEdges, newEdge]);
    },
    [wfNodes, wfEdges, onNodesEdgesChange, setEdges]
  );

  const onNodesChangeInternal = useCallback(
    (changes: NodeChange<Node<FlowNodeData>>[]) => {
      setNodes((nds) => {
        const next = applyNodeChanges(changes, nds);
        queueMicrotask(() => onNodesEdgesChange(fromFlowNodes(next), wfEdges));
        return next;
      });
    },
    [wfEdges, onNodesEdgesChange, setNodes]
  );

  const onEdgesChangeInternal = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      setEdges((eds) => {
        const next = applyEdgeChanges(changes, eds);
        queueMicrotask(() => onNodesEdgesChange(wfNodes, fromFlowEdges(next)));
        return next;
      });
    },
    [wfNodes, onNodesEdgesChange, setEdges]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData(DRAG_TYPE_AGENT);
      if (!raw || !onAddNodeAt) return;
      try {
        const parsed = JSON.parse(raw) as { agentId?: string };
        const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        onAddNodeAt(position, parsed.agentId);
      } catch {
        // ignore
      }
    },
    [screenToFlowPosition, onAddNodeAt]
  );

  const edgeOptions = useMemo(
    () => ({
      type: "labelEdge" as const,
      style: { stroke: "var(--primary)", strokeWidth: 2 },
      animated: true,
    }),
    []
  );

  const edgeTypes = useMemo(() => ({ labelEdge: CanvasLabelEdge }), []);

  const selectedEdge = selectedEdgeId ? wfEdges.find((e) => e.id === selectedEdgeId) : null;

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    setSelectedEdgeId(edge.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedEdgeId(null);
  }, []);

  const onEdgeLabelChange = useCallback(
    (edgeId: string, label: string) => {
      const nextEdges = wfEdges.map((e) =>
        e.id === edgeId ? { ...e, data: { ...e.data, label: label.trim() || undefined } } : e
      );
      onNodesEdgesChange(wfNodes, nextEdges);
    },
    [wfNodes, wfEdges, onNodesEdgesChange]
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
        <button
          type="button"
          className="button button-secondary"
          onClick={() => {
            const arranged = layoutNodesWithoutOverlap(
              wfNodes,
              (n) => n.position,
              (n, x, y) => ({ ...n, position: [x, y] as [number, number] }),
              getWorkflowGridOptions()
            );
            onNodesEdgesChange(arranged, wfEdges);
          }}
          style={{ fontSize: "0.82rem", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.35rem", marginTop: "0.25rem" }}
          title="Arrange nodes in a grid"
        >
          <LayoutGrid size={14} /> Arrange
        </button>
        <p style={{ margin: "0.5rem 0 0", fontSize: "0.72rem", color: "var(--text-muted)" }}>
          Use tools on each agent to handle input and output.
        </p>
        {selectedEdge && (
          <div
            style={{
              marginTop: "0.5rem",
              padding: "0.5rem",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--background)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.35rem" }}>
              <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>Edge</span>
              <button
                type="button"
                className="nopan nodrag"
                onClick={() => setSelectedEdgeId(null)}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex" }}
                title="Close"
              >
                <X size={14} style={{ color: "var(--text-muted)" }} />
              </button>
            </div>
            <label style={{ fontSize: "0.75rem", display: "block", marginBottom: "0.25rem" }}>Label</label>
            <input
              type="text"
              className="input nodrag nopan"
              value={selectedEdge.data?.label ?? ""}
              onChange={(e) => onEdgeLabelChange(selectedEdge.id, e.target.value)}
              placeholder="Optional label"
              style={{ width: "100%", fontSize: "0.8rem" }}
            />
          </div>
        )}
      </div>
      <div className="canvas-react-flow-wrap" style={{ flex: 1, minWidth: 0 }}>
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
          noDragClassName="nodrag"
          noPanClassName="nopan"
          noWheelClassName="nowheel"
          fitView
          fitViewOptions={{ padding: 0.2 }}
          defaultEdgeOptions={edgeOptions}
          edgeTypes={edgeTypes}
          connectionLineStyle={{ stroke: "var(--primary)", strokeWidth: 2 }}
          onEdgeClick={onEdgeClick}
          onPaneClick={onPaneClick}
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
