"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
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
import { useState } from "react";
import { Brain, Wrench, BookOpen, Save, ArrowRightLeft, Settings2, Library, LogIn, LogOut, GitBranch, Search } from "lucide-react";
import { CanvasNodeCard } from "../../components/canvas-node-card";

type ToolDef = { id: string; name: string; protocol: string; config?: Record<string, unknown>; inputSchema?: unknown };

type AgentNodeDef = { id: string; type: string; position: [number, number]; parameters?: Record<string, unknown> };
type AgentEdgeDef = { id: string; source: string; target: string };

type LlmConfig = { id: string; provider: string; model: string };

type FlowNodeData = {
  nodeType: "llm" | "tool" | "context_read" | "context_write" | "prompt" | "input" | "output" | "decision";
  config: Record<string, unknown>;
  tools: ToolDef[];
  llmConfigs?: LlmConfig[];
  onConfigChange: (nodeId: string, config: Record<string, unknown>) => void;
  onRemove: (nodeId: string) => void;
  onSaveToolToLibrary?: (nodeId: string, baseToolId: string, override: { config?: Record<string, unknown>; inputSchema?: unknown; name?: string }) => Promise<string | null>;
};

const DRAG_TYPE = "application/agent-graph-node";

function LLMNode({ id, data, selected }: NodeProps<Node<FlowNodeData>>) {
  const systemPrompt = String(data.config?.systemPrompt ?? "");
  const llmConfigId = String(data.config?.llmConfigId ?? "");
  const temperature = typeof data.config?.temperature === "number" ? data.config.temperature : undefined;
  const llmConfigs = data.llmConfigs ?? [];
  return (
    <CanvasNodeCard
      icon={<Brain size={14} style={{ color: "var(--primary)" }} />}
      label="LLM Call"
      selected={selected}
      onRemove={() => data.onRemove?.(id)}
      minWidth={200}
      maxWidth={320}
    >
      {llmConfigs.length > 0 && (
        <select
          className="nodrag nopan select"
          value={llmConfigId}
          onChange={(e) => data.onConfigChange?.(id, { ...data.config, llmConfigId: e.target.value || undefined })}
          style={{ width: "100%", fontSize: "0.8rem", marginBottom: "0.35rem" }}
        >
          <option value="">Select LLM</option>
          {llmConfigs.map((c) => (
            <option key={c.id} value={c.id}>{c.provider} / {c.model}</option>
          ))}
        </select>
      )}
      <label style={{ fontSize: "0.7rem", color: "var(--text-muted)", display: "block", marginBottom: "0.2rem" }}>Temperature (0–2)</label>
      <input
        type="number"
        className="nodrag nopan input"
        min={0}
        max={2}
        step={0.1}
        value={temperature ?? ""}
        onChange={(e) => {
          const v = e.target.value === "" ? undefined : parseFloat(e.target.value);
          data.onConfigChange?.(id, { ...data.config, temperature: v === undefined || Number.isNaN(v) ? undefined : Math.min(2, Math.max(0, v)) });
        }}
        placeholder="Default"
        style={{ width: "100%", fontSize: "0.8rem", marginBottom: "0.35rem" }}
      />
      <textarea
        className="nodrag nopan textarea"
        value={systemPrompt}
        onChange={(e) => data.onConfigChange?.(id, { ...data.config, systemPrompt: e.target.value })}
        placeholder="System prompt..."
        rows={3}
        style={{ fontSize: "0.8rem", resize: "vertical", width: "100%", minHeight: 60 }}
      />
    </CanvasNodeCard>
  );
}

function ToolNode({ id, data, selected }: NodeProps<Node<FlowNodeData>>) {
  const toolId = String(data.config?.toolId ?? "");
  const tools = data.tools ?? [];
  const override = (data.config?.override as { config?: Record<string, unknown>; inputSchema?: unknown; name?: string } | undefined) ?? {};
  const [showCustomize, setShowCustomize] = useState(false);
  const [saving, setSaving] = useState(false);
  const hasOverride = override.config && Object.keys(override.config).length > 0;

  const baseTool = tools.find((t) => t.id === toolId);
  const configKeys = baseTool?.config && typeof baseTool.config === "object"
    ? Object.keys(baseTool.config).filter((k) => !["builtin", "baseToolId"].includes(k))
    : baseTool?.protocol === "http"
      ? ["url", "method"]
      : [];

  const updateOverride = (upd: Partial<typeof override>) => {
    const next = { ...override, ...upd };
    const hasConfig = next.config && Object.keys(next.config).length > 0;
    if (!hasConfig && !next.inputSchema && !next.name) {
      const { override: _o, ...rest } = data.config ?? {};
      data.onConfigChange?.(id, rest);
    } else {
      data.onConfigChange?.(id, { ...data.config, override: next });
    }
  };

  const handleSaveToLibrary = async () => {
    if (!data.onSaveToolToLibrary || !toolId || !hasOverride) return;
    setSaving(true);
    try {
      await data.onSaveToolToLibrary(id, toolId, override);
    } finally {
      setSaving(false);
    }
  };

  return (
    <CanvasNodeCard
      icon={<Wrench size={14} style={{ color: "var(--text-muted)" }} />}
      label="Tool"
      selected={selected}
      onRemove={() => data.onRemove?.(id)}
      minWidth={180}
      maxWidth={320}
    >
      <select
        className="nodrag nopan select"
        value={toolId}
        onChange={(e) => data.onConfigChange?.(id, { ...data.config, toolId: e.target.value, override: undefined })}
        style={{ width: "100%", fontSize: "0.85rem" }}
      >
        <option value="">Select tool</option>
        {tools.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
      {toolId && (
        <>
          <button
            type="button"
            className="nodrag nopan button button-secondary button-small"
            onClick={() => setShowCustomize(!showCustomize)}
            style={{ width: "100%", marginTop: "0.35rem", fontSize: "0.75rem", padding: "0.25rem 0.5rem", display: "flex", alignItems: "center", gap: "0.35rem", justifyContent: "center" }}
            title="Customize for this agent only"
          >
            <Settings2 size={12} />
            {showCustomize ? "Hide" : "Customize"} {hasOverride && "●"}
          </button>
          {showCustomize && (
            <div className="nodrag nopan" style={{ marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid var(--border)" }}>
              {configKeys.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  {configKeys.map((key) => {
                    const val = (override.config ?? {})[key] ?? (baseTool?.config as Record<string, unknown>)?.[key] ?? "";
                    return (
                      <div key={key}>
                        <label style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{key}</label>
                        <input
                          className="input"
                          value={typeof val === "string" ? val : JSON.stringify(val)}
                          onChange={(e) => updateOverride({ config: { ...(override.config ?? {}), [key]: e.target.value } })}
                          placeholder={key}
                          style={{ width: "100%", fontSize: "0.8rem", padding: "0.2rem 0.4rem" }}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
              {configKeys.length === 0 && (
                <textarea
                  className="input textarea"
                  value={JSON.stringify(override.config ?? {}, null, 2)}
                  onChange={(e) => {
                    try {
                      const parsed = JSON.parse(e.target.value || "{}");
                      updateOverride({ config: parsed });
                    } catch {
                      // ignore invalid JSON
                    }
                  }}
                  placeholder='{"key": "value"}'
                  rows={3}
                  style={{ width: "100%", fontSize: "0.75rem", fontFamily: "monospace" }}
                />
              )}
              {hasOverride && data.onSaveToolToLibrary && (
                <button
                  type="button"
                  className="nodrag nopan button button-small"
                  onClick={handleSaveToLibrary}
                  disabled={saving}
                  style={{ marginTop: "0.5rem", width: "100%", fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.35rem", justifyContent: "center" }}
                  title="Save as new tool in library"
                >
                  <Library size={12} />
                  {saving ? "Saving…" : "Save to library"}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </CanvasNodeCard>
  );
}

function ContextReadNode({ id, data, selected }: NodeProps<Node<FlowNodeData>>) {
  const key = String(data.config?.key ?? "");
  return (
    <CanvasNodeCard
      icon={<BookOpen size={14} />}
      label="Read"
      selected={selected}
      onRemove={() => data.onRemove?.(id)}
      minWidth={140}
    >
      <input
        className="nodrag nopan input"
        value={key}
        onChange={(e) => data.onConfigChange?.(id, { ...data.config, key: e.target.value })}
        placeholder="Context key"
        style={{ width: "100%", fontSize: "0.85rem" }}
      />
    </CanvasNodeCard>
  );
}

function ContextWriteNode({ id, data, selected }: NodeProps<Node<FlowNodeData>>) {
  const key = String(data.config?.key ?? "");
  return (
    <CanvasNodeCard
      icon={<Save size={14} />}
      label="Write"
      selected={selected}
      onRemove={() => data.onRemove?.(id)}
      minWidth={140}
    >
      <input
        className="nodrag nopan input"
        value={key}
        onChange={(e) => data.onConfigChange?.(id, { ...data.config, key: e.target.value })}
        placeholder="Context key"
        style={{ width: "100%", fontSize: "0.85rem" }}
      />
    </CanvasNodeCard>
  );
}

function InputNode({ id, data, selected }: NodeProps<Node<FlowNodeData>>) {
  const transform = (data.config?.transform as { expression?: string }) ?? {};
  const expression = String(transform.expression ?? "").trim();
  return (
    <CanvasNodeCard
      icon={<LogIn size={14} style={{ color: "var(--primary)" }} />}
      label="Input"
      selected={selected}
      onRemove={() => data.onRemove?.(id)}
      handleTop={false}
      minWidth={180}
      maxWidth={280}
    >
      <textarea
        className="nodrag nopan textarea"
        value={expression}
        onChange={(e) => data.onConfigChange?.(id, { ...data.config, transform: { expression: e.target.value } })}
        placeholder='{{ $input }} or custom transform'
        rows={2}
        style={{ fontSize: "0.75rem", resize: "vertical", width: "100%", minHeight: 40 }}
      />
    </CanvasNodeCard>
  );
}

function DecisionNode({ id, data, selected }: NodeProps<Node<FlowNodeData>>) {
  const systemPrompt = String(data.config?.systemPrompt ?? "");
  const llmConfigId = String(data.config?.llmConfigId ?? "");
  const temperature = typeof data.config?.temperature === "number" ? data.config.temperature : undefined;
  const toolIds = (Array.isArray(data.config?.toolIds) ? data.config.toolIds : []) as string[];
  const llmConfigs = data.llmConfigs ?? [];
  const tools = data.tools ?? [];
  return (
    <CanvasNodeCard
      icon={<GitBranch size={14} style={{ color: "var(--primary)" }} />}
      label="Decision"
      selected={selected}
      onRemove={() => data.onRemove?.(id)}
      minWidth={220}
      maxWidth={340}
    >
      {llmConfigs.length > 0 && (
        <select
          className="nodrag nopan select"
          value={llmConfigId}
          onChange={(e) => data.onConfigChange?.(id, { ...data.config, llmConfigId: e.target.value })}
          style={{ width: "100%", fontSize: "0.8rem", marginBottom: "0.35rem" }}
        >
          <option value="">Select LLM</option>
          {llmConfigs.map((c) => (
            <option key={c.id} value={c.id}>{c.provider} / {c.model}</option>
          ))}
        </select>
      )}
      <label style={{ fontSize: "0.7rem", color: "var(--text-muted)", display: "block", marginBottom: "0.2rem" }}>Temperature (0–2)</label>
      <input
        type="number"
        className="nodrag nopan input"
        min={0}
        max={2}
        step={0.1}
        value={temperature ?? ""}
        onChange={(e) => {
          const v = e.target.value === "" ? undefined : parseFloat(e.target.value);
          data.onConfigChange?.(id, { ...data.config, temperature: v === undefined || Number.isNaN(v) ? undefined : Math.min(2, Math.max(0, v)) });
        }}
        placeholder="Default"
        style={{ width: "100%", fontSize: "0.8rem", marginBottom: "0.35rem" }}
      />
      <label style={{ fontSize: "0.7rem", color: "var(--text-muted)", display: "block", marginBottom: "0.25rem" }}>Tools</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginBottom: "0.35rem" }}>
        {tools.map((t) => {
          const checked = toolIds.includes(t.id);
          return (
            <label key={t.id} className="nodrag nopan" style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.75rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => {
                  const next = checked ? toolIds.filter((x) => x !== t.id) : [...toolIds, t.id];
                  data.onConfigChange?.(id, { ...data.config, toolIds: next });
                }}
              />
              {t.name}
            </label>
          );
        })}
      </div>
      <textarea
        className="nodrag nopan textarea"
        value={systemPrompt}
        onChange={(e) => data.onConfigChange?.(id, { ...data.config, systemPrompt: e.target.value })}
        placeholder="System prompt..."
        rows={3}
        style={{ fontSize: "0.8rem", resize: "vertical", width: "100%", minHeight: 60 }}
      />
    </CanvasNodeCard>
  );
}

function OutputNode({ id, data, selected }: NodeProps<Node<FlowNodeData>>) {
  const transform = (data.config?.transform as { expression?: string }) ?? {};
  const expression = String(transform.expression ?? "").trim();
  return (
    <CanvasNodeCard
      icon={<LogOut size={14} style={{ color: "var(--primary)" }} />}
      label="Output"
      selected={selected}
      onRemove={() => data.onRemove?.(id)}
      handleBottom={false}
      minWidth={180}
      maxWidth={280}
    >
      <textarea
        className="nodrag nopan textarea"
        value={expression}
        onChange={(e) => data.onConfigChange?.(id, { ...data.config, transform: { expression: e.target.value } })}
        placeholder='{{ $input }} or custom transform'
        rows={2}
        style={{ fontSize: "0.75rem", resize: "vertical", width: "100%", minHeight: 40 }}
      />
    </CanvasNodeCard>
  );
}

const nodeTypes = {
  llm: LLMNode,
  decision: DecisionNode,
  tool: ToolNode,
  context_read: ContextReadNode,
  context_write: ContextWriteNode,
  input: InputNode,
  output: OutputNode,
};

function toFlowNode(
  n: AgentNodeDef,
  i: number,
  tools: ToolDef[],
  onConfigChange: (nodeId: string, config: Record<string, unknown>) => void,
  onRemove: (nodeId: string) => void,
  onSaveToolToLibrary?: FlowNodeData["onSaveToolToLibrary"],
  llmConfigs?: LlmConfig[]
): Node<FlowNodeData> {
  const pos = Array.isArray(n.position) ? { x: n.position[0], y: n.position[1] } : { x: 80 + (i % 2) * 260, y: 80 + Math.floor(i / 2) * 160 };
  const config = n.parameters ?? {};
  const validTypes = ["llm", "decision", "tool", "context_read", "context_write", "input", "output"] as const;
  const type = (validTypes.includes(n.type as typeof validTypes[number]) ? n.type : "llm") as FlowNodeData["nodeType"];
  return {
    id: n.id,
    type,
    position: pos,
    data: {
      nodeType: type,
      config,
      tools,
      llmConfigs,
      onConfigChange,
      onRemove,
      onSaveToolToLibrary,
    },
  };
}

function toFlowEdges(edges: AgentEdgeDef[]): Edge[] {
  return edges.map((e) => ({ id: e.id, source: e.source, target: e.target }));
}

function fromFlowToAgentGraph(nodes: Node<FlowNodeData>[], edges: Edge[]): { nodes: AgentNodeDef[]; edges: AgentEdgeDef[] } {
  const sorted = [...nodes].sort((a, b) => {
    const ay = a.position?.y ?? 0, by = b.position?.y ?? 0;
    if (Math.abs(ay - by) > 20) return ay - by;
    return (a.position?.x ?? 0) - (b.position?.x ?? 0);
  });
  const agentNodes: AgentNodeDef[] = sorted.map((n) => ({
    id: n.id,
    type: n.data?.nodeType ?? "llm",
    position: [n.position?.x ?? 0, n.position?.y ?? 0],
    parameters: n.data?.config ?? {},
  }));
  const agentEdges: AgentEdgeDef[] = edges.map((e) => ({
    id: e.id ?? `e-${e.source}-${e.target}`,
    source: e.source,
    target: e.target,
  }));
  return { nodes: agentNodes, edges: agentEdges };
}

type Props = {
  nodes: AgentNodeDef[];
  edges: AgentEdgeDef[];
  tools: ToolDef[];
  llmConfigs?: LlmConfig[];
  onNodesEdgesChange: (nodes: AgentNodeDef[], edges: AgentEdgeDef[]) => void;
  onSaveToolToLibrary?: (nodeId: string, baseToolId: string, override: { config?: Record<string, unknown>; inputSchema?: unknown; name?: string }) => Promise<string | null>;
};

function AgentCanvasInner({ nodes, edges, tools, llmConfigs = [], onNodesEdgesChange, onSaveToolToLibrary }: Props) {
  const { screenToFlowPosition } = useReactFlow();

  const onConfigChange = useCallback(
    (nodeId: string, config: Record<string, unknown>) => {
      const next = nodes.map((n) => (n.id === nodeId ? { ...n, parameters: config } : n));
      onNodesEdgesChange(next, edges);
    },
    [nodes, edges, onNodesEdgesChange]
  );

  const onRemove = useCallback(
    (nodeId: string) => {
      const nextNodes = nodes.filter((n) => n.id !== nodeId);
      const nextEdges = edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
      onNodesEdgesChange(nextNodes, nextEdges);
    },
    [nodes, edges, onNodesEdgesChange]
  );

  const addNode = useCallback(
    (type: FlowNodeData["nodeType"], position?: { x: number; y: number }, toolId?: string) => {
      const id = `n-${crypto.randomUUID().slice(0, 8)}`;
      const pos = position ?? { x: 100 + nodes.length * 30, y: 100 + nodes.length * 30 };
      const baseParams =
        type === "llm" ? { systemPrompt: "" }
        : type === "decision" ? { systemPrompt: "", llmConfigId: "", toolIds: [] as string[] }
        : type === "tool" ? { toolId: toolId ?? "" }
        : type === "context_read" || type === "context_write" ? { key: "" }
        : type === "input" || type === "output" ? { transform: { expression: "" } }
        : { systemPrompt: "" };
      const newNode: AgentNodeDef = {
        id,
        type,
        position: [pos.x, pos.y],
        parameters: baseParams,
      };
      onNodesEdgesChange([...nodes, newNode], edges);
    },
    [nodes, edges, onNodesEdgesChange]
  );

  const initialNodes = useMemo(
    () => nodes.map((n, i) => toFlowNode(n, i, tools, onConfigChange, onRemove, onSaveToolToLibrary, llmConfigs)),
    [nodes, tools, llmConfigs, onConfigChange, onRemove, onSaveToolToLibrary]
  );
  const initialEdges = useMemo(() => toFlowEdges(edges), [edges]);

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(initialNodes);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setFlowNodes(nodes.map((n, i) => toFlowNode(n, i, tools, onConfigChange, onRemove, onSaveToolToLibrary, llmConfigs)));
    setFlowEdges(toFlowEdges(edges));
  }, [nodes.length, edges.length, JSON.stringify(nodes.map((n) => [n.id, n.type, n.parameters])), JSON.stringify(edges), llmConfigs, onSaveToolToLibrary]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setFlowEdges((eds) => addEdge(connection, eds));
      const newEdge: AgentEdgeDef = {
        id: `e-${connection.source}-${connection.target}`,
        source: connection.source ?? "",
        target: connection.target ?? "",
      };
      onNodesEdgesChange(nodes, [...edges, newEdge]);
    },
    [nodes, edges, onNodesEdgesChange]
  );

  const onNodesChangeInternal = useCallback(
    (changes: NodeChange<Node<FlowNodeData>>[]) => {
      setFlowNodes((nds) => {
        const next = applyNodeChanges(changes, nds);
        const { nodes: agentNodes, edges: agentEdges } = fromFlowToAgentGraph(next, flowEdges);
        queueMicrotask(() => onNodesEdgesChange(agentNodes, agentEdges));
        return next;
      });
    },
    [flowEdges, onNodesEdgesChange]
  );

  const onEdgesChangeInternal = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      setFlowEdges((eds) => {
        const next = applyEdgeChanges(changes, eds);
        const { nodes: agentNodes, edges: agentEdges } = fromFlowToAgentGraph(flowNodes, next);
        queueMicrotask(() => onNodesEdgesChange(agentNodes, agentEdges));
        return next;
      });
    },
    [flowNodes, onNodesEdgesChange]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData(DRAG_TYPE);
      if (!raw) return;
      try {
        const { type, toolId } = JSON.parse(raw) as { type: FlowNodeData["nodeType"]; toolId?: string };
        const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        if (type === "tool" && !toolId) {
          setToolSearchPosition(position);
          setToolSearchOpen(true);
          return;
        }
        addNode(type, position, toolId);
      } catch {
        // ignore
      }
    },
    [screenToFlowPosition, addNode]
  );

  const edgeOptions = useMemo(
    () => ({
      type: "smoothstep" as const,
      style: { stroke: "var(--primary)", strokeWidth: 2 },
      animated: true,
    }),
    []
  );

  const dragStart = (type: FlowNodeData["nodeType"], toolId?: string) => (ev: React.DragEvent) => {
    ev.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ type, toolId }));
  };

  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [toolSearchOpen, setToolSearchOpen] = useState(false);
  const [toolSearchQuery, setToolSearchQuery] = useState("");
  const [toolSearchPosition, setToolSearchPosition] = useState<{ x: number; y: number } | undefined>(undefined);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const toolSearchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) setAddMenuOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  useEffect(() => {
    if (toolSearchOpen) {
      setToolSearchQuery("");
      queueMicrotask(() => toolSearchInputRef.current?.focus());
    }
  }, [toolSearchOpen]);

  const openToolSearch = (position?: { x: number; y: number }) => {
    setToolSearchPosition(position);
    setToolSearchOpen(true);
    setAddMenuOpen(false);
  };

  const filteredTools = useMemo(() => {
    const q = toolSearchQuery.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter((t) => t.name.toLowerCase().includes(q) || (t.protocol?.toLowerCase().includes(q)));
  }, [tools, toolSearchQuery]);

  const sidebarItemStyles: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    padding: "0.35rem 0.5rem",
    borderRadius: 6,
    background: "var(--background)",
    border: "1px solid var(--border)",
    cursor: "grab",
    fontSize: "0.82rem",
    width: "100%",
  };

  return (
    <div className="canvas-wrap">
      <div
        ref={addMenuRef}
        style={{
          width: 140,
          flexShrink: 0,
          borderRight: "1px solid var(--border)",
          padding: "0.5rem",
          background: "var(--surface)",
          display: "flex",
          flexDirection: "column",
          gap: "0.35rem",
          overflow: "hidden",
        }}
      >
        <p style={{ margin: 0, fontSize: "0.72rem", color: "var(--text-muted)" }}>
          Drag onto canvas or click to add.
        </p>
        <div style={{ position: "relative" }}>
          <button
            type="button"
            className="button"
            onClick={() => setAddMenuOpen((o) => !o)}
            style={{ fontSize: "0.82rem", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.35rem" }}
          >
            <Brain size={14} /> Add node
          </button>
          {addMenuOpen && (
            <div
              className="nodrag nopan"
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                marginTop: 4,
                padding: "0.35rem",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
                zIndex: 1000,
                maxHeight: 280,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              {(["input", "output"] as const).map((t) => (
                <div
                  key={t}
                  draggable
                  onDragStart={dragStart(t)}
                  onClick={() => { addNode(t); setAddMenuOpen(false); }}
                  style={sidebarItemStyles}
                >
                  {t === "input" ? <LogIn size={14} /> : <LogOut size={14} />}
                  {t}
                </div>
              ))}
              <div
                draggable
                onDragStart={dragStart("llm")}
                onClick={() => { addNode("llm"); setAddMenuOpen(false); }}
                style={sidebarItemStyles}
              >
                <Brain size={14} /> LLM
              </div>
              <div
                draggable
                onDragStart={dragStart("decision")}
                onClick={() => { addNode("decision"); setAddMenuOpen(false); }}
                style={sidebarItemStyles}
              >
                <GitBranch size={14} /> Decision
              </div>
              {(["context_read", "context_write"] as const).map((t) => (
                <div
                  key={t}
                  draggable
                  onDragStart={dragStart(t)}
                  onClick={() => { addNode(t); setAddMenuOpen(false); }}
                  style={sidebarItemStyles}
                >
                  <ArrowRightLeft size={14} />
                  {t.replace("_", " ")}
                </div>
              ))}
              <span style={{ fontSize: "0.65rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", padding: "0.25rem 0.35rem 0.15rem", marginTop: 4 }}>Tools</span>
              <div
                draggable
                onDragStart={(ev) => ev.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ type: "tool" as const }))}
                onClick={() => openToolSearch()}
                style={{ ...sidebarItemStyles, cursor: "pointer", border: "1px dashed var(--border)", background: "var(--surface-muted)", justifyContent: "center" }}
              >
                <Search size={14} /> Search tools…
              </div>
              {tools.length === 0 ? (
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", padding: "0.25rem 0.35rem" }}>No tools</span>
              ) : (
                tools.map((t) => (
                  <div
                    key={t.id}
                    draggable
                    onDragStart={(ev) => ev.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ type: "tool" as const, toolId: t.id }))}
                    onClick={() => { addNode("tool", undefined, t.id); setAddMenuOpen(false); }}
                    style={sidebarItemStyles}
                  >
                    <Wrench size={14} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
      {toolSearchOpen && (
        <div
          className="nodrag nopan"
          role="dialog"
          aria-label="Select tool"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10001,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(15, 23, 42, 0.5)",
            padding: "1.5rem",
          }}
          onClick={(e) => e.target === e.currentTarget && setToolSearchOpen(false)}
        >
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              boxShadow: "var(--shadow)",
              width: "100%",
              maxWidth: 420,
              maxHeight: "80vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
              <h3 style={{ margin: "0 0 0.75rem", fontSize: "1rem", fontWeight: 600 }}>Select tool</h3>
              <input
                ref={toolSearchInputRef}
                type="search"
                className="input"
                placeholder="Search by name or protocol…"
                value={toolSearchQuery}
                onChange={(e) => setToolSearchQuery(e.target.value)}
                style={{ width: "100%", fontSize: "0.9rem" }}
              />
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "0.5rem", minHeight: 200 }}>
              {filteredTools.length === 0 ? (
                <p style={{ margin: "1rem 0", fontSize: "0.88rem", color: "var(--text-muted)" }}>
                  {tools.length === 0 ? "No tools in library." : "No tools match your search."}
                </p>
              ) : (
                filteredTools.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="nodrag nopan"
                    onClick={() => {
                      addNode("tool", toolSearchPosition, t.id);
                      setToolSearchOpen(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      width: "100%",
                      padding: "0.6rem 0.75rem",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      background: "var(--surface-muted)",
                      color: "var(--text)",
                      fontSize: "0.9rem",
                      cursor: "pointer",
                      textAlign: "left",
                      marginBottom: "0.35rem",
                    }}
                  >
                    <Wrench size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</span>
                    {t.protocol && (
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{t.protocol}</span>
                    )}
                  </button>
                ))
              )}
            </div>
            <div style={{ padding: "0.75rem 1.25rem", borderTop: "1px solid var(--border)" }}>
              <button type="button" className="button" style={{ fontSize: "0.85rem" }} onClick={() => setToolSearchOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0, height: "100%" }}>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
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

export default function AgentCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <AgentCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
