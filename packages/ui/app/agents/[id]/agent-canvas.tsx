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
  Position,
  type Connection,
  type Node,
  type Edge,
  type NodeProps,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useState } from "react";
import { Brain, Wrench, BookOpen, Save, ArrowRightLeft, Settings2, Library, LogIn, LogOut, GitBranch, Search, LayoutGrid, X } from "lucide-react";
import { CanvasNodeCard } from "../../components/canvas-node-card";
import { CanvasLabelEdge } from "../../components/canvas-label-edge";
import { getGridPosition, getNextNodePosition, getAgentGridOptions, layoutNodesByGraph } from "../../lib/canvas-layout";

type ToolDef = { id: string; name: string; protocol: string; config?: Record<string, unknown>; inputSchema?: unknown };

type AgentNodeDef = { id: string; type: string; position: [number, number]; parameters?: Record<string, unknown> };
type AgentEdgeDef = { id: string; source: string; target: string; data?: { label?: string } };

type LlmConfig = { id: string; provider: string; model: string };

/** Tool as represented by a tool node on the canvas (for Decision node to reference). */
type CanvasToolRef = { nodeId: string; toolId: string; name: string };

type FlowNodeData = {
  nodeType: "llm" | "tool" | "context_read" | "context_write" | "prompt" | "input" | "output" | "decision";
  config: Record<string, unknown>;
  tools: ToolDef[];
  /** Tools that exist as tool nodes on the canvas; used by Decision node. */
  canvasTools?: CanvasToolRef[];
  /** For LLM nodes: tools connected from this node (llm→tool edges) — what this LLM can call. */
  connectedTools?: CanvasToolRef[];
  llmConfigs?: LlmConfig[];
  onConfigChange: (nodeId: string, config: Record<string, unknown>) => void;
  onRemove: (nodeId: string) => void;
  onSaveToolToLibrary?: (nodeId: string, baseToolId: string, override: { config?: Record<string, unknown>; inputSchema?: unknown; name?: string }) => Promise<string | null>;
};

const DRAG_TYPE = "application/agent-graph-node";

/** Short unique id; works when crypto.randomUUID is unavailable (e.g. HTTP). */
function randomNodeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().slice(0, 8);
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function LLMNode({ id, data, selected }: NodeProps<Node<FlowNodeData>>) {
  const systemPrompt = String(data.config?.systemPrompt ?? "");
  const llmConfigId = String(data.config?.llmConfigId ?? "");
  const temperature = typeof data.config?.temperature === "number" ? data.config.temperature : undefined;
  const llmConfigs = data.llmConfigs ?? [];
  const connectedTools = data.connectedTools ?? [];
  return (
    <CanvasNodeCard
      icon={<Brain size={14} style={{ color: "var(--primary)" }} />}
      label="LLM"
      selected={selected}
      onRemove={() => data.onRemove?.(id)}
      handleLeft={true}
      handleRight={true}
      minWidth={200}
      maxWidth={320}
    >
      {connectedTools.length > 0 && (
        <div className="nodrag nopan" style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: "0.35rem" }}>
          <span style={{ fontWeight: 600 }}>Tools:</span> {connectedTools.map((ct) => ct.name).join(", ")}
        </div>
      )}
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
        className="nodrag nopan nowheel textarea"
        value={systemPrompt}
        onChange={(e) => data.onConfigChange?.(id, { ...data.config, systemPrompt: e.target.value })}
        placeholder="System prompt..."
        rows={3}
        style={{ fontSize: "0.8rem", resize: "vertical", width: "100%", minHeight: 60, maxHeight: 160, overflowY: "auto" }}
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
      label={baseTool?.name ?? "Tool"}
      selected={selected}
      onRemove={() => data.onRemove?.(id)}
      handleLeft={true}
      handleRight={true}
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
                          className="nodrag nopan input"
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
                  className="nodrag nopan nowheel input textarea"
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
      handleLeft={true}
      handleRight={true}
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
      handleLeft={true}
      handleRight={true}
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
      handleLeft={false}
      handleRight={true}
      minWidth={180}
      maxWidth={280}
    >
      <textarea
        className="nodrag nopan nowheel textarea"
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
  const canvasTools = data.canvasTools ?? [];
  return (
    <CanvasNodeCard
      icon={<GitBranch size={14} style={{ color: "var(--primary)" }} />}
      label="Decision"
      selected={selected}
      onRemove={() => data.onRemove?.(id)}
      handleLeft={true}
      handleRight={true}
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
      <label style={{ fontSize: "0.7rem", color: "var(--text-muted)", display: "block", marginBottom: "0.25rem" }}>Tools (from canvas)</label>
      {canvasTools.length === 0 ? (
        <p className="decision-tools-empty nodrag nopan">Add tools to the canvas to use them in this decision.</p>
      ) : (
        <div className="decision-tools-list nodrag nopan">
          {canvasTools.map((ct) => {
            const checked = toolIds.includes(ct.toolId);
            return (
              <label key={ct.nodeId} className="decision-tool-check">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = checked ? toolIds.filter((x) => x !== ct.toolId) : [...toolIds, ct.toolId];
                    data.onConfigChange?.(id, { ...data.config, toolIds: next });
                  }}
                />
                {ct.name}
              </label>
            );
          })}
        </div>
      )}
      <textarea
        className="nodrag nopan nowheel textarea"
        value={systemPrompt}
        onChange={(e) => data.onConfigChange?.(id, { ...data.config, systemPrompt: e.target.value })}
        placeholder="System prompt..."
        rows={3}
        style={{ fontSize: "0.8rem", resize: "vertical", width: "100%", minHeight: 60, maxHeight: 160, overflowY: "auto" }}
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
      handleLeft={true}
      handleRight={false}
      minWidth={180}
      maxWidth={280}
    >
      <textarea
        className="nodrag nopan nowheel textarea"
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

/** Build list of tools that exist as tool nodes on the canvas (for Decision node). */
function getCanvasTools(nodes: AgentNodeDef[], tools: ToolDef[]): CanvasToolRef[] {
  const refs: CanvasToolRef[] = [];
  for (const node of nodes) {
    if (node.type !== "tool") continue;
    const toolId = String((node.parameters as { toolId?: string })?.toolId ?? "").trim();
    if (!toolId) continue;
    const tool = tools.find((t) => t.id === toolId);
    refs.push({ nodeId: node.id, toolId, name: tool?.name ?? toolId });
  }
  return refs;
}

/** For a given node (typically LLM), return tools connected from it via edges (source=nodeId → target=tool node). */
function getConnectedToolsForNode(
  nodeId: string,
  nodes: AgentNodeDef[],
  edges: AgentEdgeDef[],
  tools: ToolDef[]
): CanvasToolRef[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const refs: CanvasToolRef[] = [];
  for (const e of edges) {
    if (e.source !== nodeId) continue;
    const target = nodeMap.get(e.target);
    if (target?.type !== "tool") continue;
    const toolId = String((target.parameters as { toolId?: string })?.toolId ?? "").trim();
    if (!toolId) continue;
    const tool = tools.find((t) => t.id === toolId);
    refs.push({ nodeId: target.id, toolId, name: tool?.name ?? toolId });
  }
  return refs;
}

function toFlowNode(
  n: AgentNodeDef,
  i: number,
  tools: ToolDef[],
  allNodes: AgentNodeDef[],
  allEdges: AgentEdgeDef[],
  onConfigChange: (nodeId: string, config: Record<string, unknown>) => void,
  onRemove: (nodeId: string) => void,
  onSaveToolToLibrary?: FlowNodeData["onSaveToolToLibrary"],
  llmConfigs?: LlmConfig[]
): Node<FlowNodeData> {
  const gridOpts = getAgentGridOptions();
  const pos = Array.isArray(n.position) && n.position.length >= 2 && Number.isFinite(n.position[0]) && Number.isFinite(n.position[1])
    ? { x: n.position[0], y: n.position[1] }
    : getGridPosition(i, gridOpts);
  const config = n.parameters ?? {};
  const validTypes = ["llm", "decision", "tool", "context_read", "context_write", "input", "output"] as const;
  const type = (validTypes.includes(n.type as typeof validTypes[number]) ? n.type : "llm") as FlowNodeData["nodeType"];
  const canvasTools = getCanvasTools(allNodes, tools);
  const connectedTools = (type === "llm" || type === "decision") ? getConnectedToolsForNode(n.id, allNodes, allEdges, tools) : undefined;
  return {
    id: n.id,
    type,
    position: pos,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    dragHandle: ".drag-handle",
    data: {
      nodeType: type,
      config,
      tools,
      canvasTools,
      connectedTools,
      llmConfigs,
      onConfigChange,
      onRemove,
      onSaveToolToLibrary,
    },
  };
}

function toFlowEdges(edges: AgentEdgeDef[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: "labelEdge",
    data: { label: e.data?.label ?? "" },
  }));
}

function fromFlowToAgentGraph(nodes: Node<FlowNodeData>[], edges: Edge[]): { nodes: AgentNodeDef[]; edges: AgentEdgeDef[] } {
  const sorted = [...nodes].sort((a, b) => {
    const ax = a.position?.x ?? 0, bx = b.position?.x ?? 0;
    if (Math.abs(ax - bx) > 20) return ax - bx;
    return (a.position?.y ?? 0) - (b.position?.y ?? 0);
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
    data: e.data && typeof e.data === "object" && "label" in e.data
      ? { label: typeof (e.data as { label?: unknown }).label === "string" ? (e.data as { label: string }).label : undefined }
      : undefined,
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
  /** Called after Arrange is applied with the new nodes/edges so the page can auto-save. */
  onArrangeComplete?: (nodes: AgentNodeDef[], edges: AgentEdgeDef[]) => void;
};

function AgentCanvasInner({ nodes, edges, tools, llmConfigs = [], onNodesEdgesChange, onSaveToolToLibrary, onArrangeComplete }: Props) {
  const { screenToFlowPosition } = useReactFlow();
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const setFlowNodesRef = useRef<React.Dispatch<React.SetStateAction<Node<FlowNodeData>[]>>>(() => {});
  const llmConfigsRef = useRef<LlmConfig[]>(llmConfigs);
  const onSaveToolToLibraryRef = useRef(typeof onSaveToolToLibrary === "function" ? onSaveToolToLibrary : undefined);
  const isDraggingRef = useRef(false);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  llmConfigsRef.current = llmConfigs;
  onSaveToolToLibraryRef.current = typeof onSaveToolToLibrary === "function" ? onSaveToolToLibrary : undefined;

  // #region agent log
  useEffect(() => {
    const t = setTimeout(() => {
      const portal = document.querySelector(".react-flow__viewport-portal");
      const viewport = document.querySelector(".react-flow__viewport");
      const nodesContainer = document.querySelector(".react-flow__nodes");
      const firstNode = document.querySelector(".react-flow__node");
      const getStyle = (el: Element | null) =>
        el ? { pointerEvents: getComputedStyle(el).pointerEvents, zIndex: getComputedStyle(el).zIndex } : null;
      fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hypothesisId: "H1",
          location: "agent-canvas.tsx:computed-styles",
          message: "computed pointer-events and z-index for key elements",
          data: {
            viewportPortal: getStyle(portal),
            viewport: getStyle(viewport),
            nodesContainer: getStyle(nodesContainer),
            firstNode: getStyle(firstNode),
            timestamp: Date.now(),
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});

      const nodeEl = document.querySelector(".react-flow__node");
      const cardEl = nodeEl?.firstElementChild ?? null;
      const handleLeft = document.querySelector(".react-flow__handle-left");
      const handleRight = document.querySelector(".react-flow__handle-right");
      const rect = (el: Element | null) =>
        el ? { ...el.getBoundingClientRect() } : null;
      const cs = (el: Element | null) => {
        if (!el) return null;
        const s = getComputedStyle(el);
        return {
          position: s.position,
          top: s.top,
          left: s.left,
          right: s.right,
          bottom: s.bottom,
          transform: s.transform,
          width: s.width,
          height: s.height,
        };
      };
      const data = {
        nodeRect: rect(nodeEl ?? null),
        cardRect: rect(cardEl ?? null),
        handleLeftRect: rect(handleLeft ?? null),
        handleRightRect: rect(handleRight ?? null),
        nodeComputed: cs(nodeEl ?? null),
        cardComputed: cs(cardEl ?? null),
        handleLeftComputed: cs(handleLeft ?? null),
        handleRightComputed: cs(handleRight ?? null),
        cardIsPositionRelative: cardEl ? getComputedStyle(cardEl).position === "relative" : null,
      };
      fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hypothesisId: "H6",
          location: "agent-canvas.tsx:handle-position",
          message: "handle and card rects + computed styles (root cause for wrong handle position)",
          data,
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, []);
  // #endregion

  // #region agent log
  useEffect(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    let lastMove = 0;
    const throttleMs = 150;
    const logPointer = (type: string, ev: PointerEvent) => {
      const t = ev.target as HTMLElement;
      const tag = t?.tagName ?? "";
      const cls = (t?.className && String(t.className).slice(0, 120)) ?? "";
      const computedCursor = t && typeof getComputedStyle !== "undefined" ? getComputedStyle(t).cursor : "";
      const parentChain: string[] = [];
      let p: HTMLElement | null = t?.parentElement ?? null;
      for (let i = 0; i < 5 && p; i++) {
        const c = (p.className && String(p.className).slice(0, 60)) || "";
        parentChain.push(`${(p.tagName || "").toLowerCase()}${c ? "." + c.split(" ").filter(Boolean).slice(0, 2).join(".") : ""}`);
        p = p.parentElement;
      }
      const data = {
        type,
        targetTag: tag,
        targetClass: cls,
        targetId: (t as HTMLElement)?.id ?? "",
        computedCursor: computedCursor,
        isSelect: tag === "SELECT" || !!(t && t.closest?.("select")),
        isInput: tag === "INPUT" || tag === "TEXTAREA" || !!(t && t.closest?.('input, textarea')),
        isNode: !!(t && t.closest?.(".react-flow__node")),
        isViewport: !!(t && t.classList?.contains?.("react-flow__viewport")),
        isNodesContainer: !!(t && t.classList?.contains?.("react-flow__nodes")),
        isNopan: !!(t && t.closest?.(".nopan")),
        isPortal: !!(t && t.closest?.(".react-flow__viewport-portal")),
        isPane: !!(t && t.closest?.(".react-flow__pane")),
        isCanvasWrap: !!(t && t.closest?.(".canvas-react-flow-wrap")),
        isDragHandle: !!(t && t.closest?.(".drag-handle")),
        parentChain: parentChain.slice(0, 4),
      };
      fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hypothesisId: type === "pointerdown" ? "H3" : "H2",
          location: "agent-canvas.tsx:pointer-target",
          message: type === "pointerdown" ? "click target" : "hover target",
          data,
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    };
    const onMove = (ev: Event) => {
      const now = Date.now();
      if (now - lastMove < throttleMs) return;
      lastMove = now;
      logPointer("pointermove", ev as PointerEvent);
    };
    const onDown = (ev: Event) => logPointer("pointerdown", ev as PointerEvent);
    wrap.addEventListener("pointermove", onMove, true);
    wrap.addEventListener("pointerdown", onDown, true);
    return () => {
      wrap.removeEventListener("pointermove", onMove, true);
      wrap.removeEventListener("pointerdown", onDown, true);
    };
  }, []);
  // #endregion

  const onConfigChange = useCallback(
    (nodeId: string, config: Record<string, unknown>) => {
      fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hypothesisId: "H4",
          location: "agent-canvas.tsx:onConfigChange",
          message: "onConfigChange called (e.g. dropdown selection)",
          data: { nodeId, keys: Object.keys(config || {}), nodesLength: nodes.length },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      const next = nodes.map((n) => (n.id === nodeId ? { ...n, parameters: config } : n));
      onNodesEdgesChange(next, edges);
      setFlowNodesRef.current((nds) =>
        nds.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, config } } : n
        )
      );
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
      const id = `n-${randomNodeId()}`;
      const existingPositions = nodes.map((n) => ({ x: n.position[0], y: n.position[1] }));
      const pos = position ?? getNextNodePosition(existingPositions, getAgentGridOptions());
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
    () => nodes.map((n, i) => toFlowNode(n, i, tools, nodes, edges, onConfigChange, onRemove, onSaveToolToLibrary, llmConfigs)),
    [nodes, edges, tools, llmConfigs, onConfigChange, onRemove, onSaveToolToLibrary]
  );
  const initialEdges = useMemo(() => toFlowEdges(edges), [edges]);

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(initialNodes);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState(initialEdges);
  setFlowNodesRef.current = setFlowNodes;

  /* Sync props → flow state only when structure changes (add/remove/move), not when only config changes (e.g. dropdown). Refs for llmConfigs/onSaveToolToLibrary avoid effect loop from unstable parent refs. Skip sync while user is dragging to prevent flicker. */
  useEffect(() => {
    if (isDraggingRef.current) return;
    const structKey = JSON.stringify(nodes.map((n) => [n.id, n.position]));
    const edgesKey = JSON.stringify(edges);
    // #region agent log
    fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hypothesisId: "H5",
        location: "agent-canvas.tsx:sync-effect",
        message: "sync effect ran: setFlowNodes/setFlowEdges (full replace)",
        data: { nodesLength: nodes.length, edgesLength: edges.length, structKeyLen: structKey.length, edgesKeyLen: edgesKey.length },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    const llm = llmConfigsRef.current;
    const onSave = onSaveToolToLibraryRef.current;
    setFlowNodes(nodes.map((n, i) => toFlowNode(n, i, tools, nodes, edges, onConfigChange, onRemove, onSave ?? (() => Promise.resolve(null)), llm)));
    setFlowEdges(toFlowEdges(edges));
  }, [nodes.length, edges.length, JSON.stringify(nodes.map((n) => [n.id, n.position])), JSON.stringify(edges)]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setFlowEdges((eds) => addEdge(connection, eds));
      const newEdge: AgentEdgeDef = {
        id: `e-${connection.source}-${connection.target}`,
        source: connection.source ?? "",
        target: connection.target ?? "",
        data: {},
      };
      onNodesEdgesChange(nodes, [...edges, newEdge]);
    },
    [nodes, edges, onNodesEdgesChange, setFlowEdges]
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
    [flowEdges, onNodesEdgesChange, setFlowNodes]
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
    [flowNodes, onNodesEdgesChange, setFlowEdges]
  );

  const [addNodeModalOpen, setAddNodeModalOpen] = useState(false);
  const [toolSearchOpen, setToolSearchOpen] = useState(false);
  const [toolSearchQuery, setToolSearchQuery] = useState("");
  const [toolSearchPosition, setToolSearchPosition] = useState<{ x: number; y: number } | undefined>(undefined);
  const [addModalQuery, setAddModalQuery] = useState("");
  const addMenuRef = useRef<HTMLDivElement>(null);
  const toolSearchInputRef = useRef<HTMLInputElement>(null);
  const addModalInputRef = useRef<HTMLInputElement>(null);

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
      type: "labelEdge" as const,
      style: { stroke: "var(--primary)", strokeWidth: 2 },
      animated: true,
    }),
    []
  );

  const edgeTypes = useMemo(() => ({ labelEdge: CanvasLabelEdge }), []);

  const selectedEdge = selectedEdgeId ? edges.find((e) => e.id === selectedEdgeId) : null;

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    setSelectedEdgeId(edge.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedEdgeId(null);
  }, []);

  const onEdgeLabelChange = useCallback(
    (edgeId: string, label: string) => {
      const nextEdges = edges.map((e) =>
        e.id === edgeId ? { ...e, data: { ...e.data, label: label.trim() || undefined } } : e
      );
      onNodesEdgesChange(nodes, nextEdges);
    },
    [nodes, edges, onNodesEdgesChange]
  );

  const dragStart = (type: FlowNodeData["nodeType"], toolId?: string) => (ev: React.DragEvent) => {
    ev.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ type, toolId }));
  };

  useEffect(() => {
    if (addNodeModalOpen) {
      queueMicrotask(() => {
        setAddModalQuery("");
        addModalInputRef.current?.focus();
      });
    }
  }, [addNodeModalOpen]);

  useEffect(() => {
    if (toolSearchOpen) {
      queueMicrotask(() => {
        setToolSearchQuery("");
        toolSearchInputRef.current?.focus();
      });
    }
  }, [toolSearchOpen]);

  const openToolSearch = (position?: { x: number; y: number }) => {
    setToolSearchPosition(position);
    setAddNodeModalOpen(false);
    setToolSearchOpen(true);
  };

  /** Unified list: LLM, Input, Output, Decision, Context read/write, and all library tools — so everything appears as "tools" for the agent. */
  const addableItems = useMemo(() => {
    const nodeItems: { kind: "node"; type: FlowNodeData["nodeType"]; label: string; icon: React.ReactNode }[] = [
      { kind: "node", type: "llm", label: "LLM", icon: <Brain size={18} className="add-node-modal-item-icon" /> },
      { kind: "node", type: "input", label: "Input", icon: <LogIn size={18} className="add-node-modal-item-icon" /> },
      { kind: "node", type: "output", label: "Output", icon: <LogOut size={18} className="add-node-modal-item-icon" /> },
      { kind: "node", type: "decision", label: "Decision", icon: <GitBranch size={18} className="add-node-modal-item-icon" /> },
      { kind: "node", type: "context_read", label: "Context read", icon: <ArrowRightLeft size={18} className="add-node-modal-item-icon" /> },
      { kind: "node", type: "context_write", label: "Context write", icon: <ArrowRightLeft size={18} className="add-node-modal-item-icon" /> },
    ];
    const toolItems = tools.map((t) => ({
      kind: "tool" as const,
      toolId: t.id,
      label: t.name,
      icon: <Wrench size={18} className="add-node-modal-item-icon" />,
    }));
    return [...nodeItems, ...toolItems];
  }, [tools]);

  const filteredAddableItems = useMemo(() => {
    const q = addModalQuery.trim().toLowerCase();
    if (!q) return addableItems;
    return addableItems.filter((item) => item.label.toLowerCase().includes(q));
  }, [addableItems, addModalQuery]);

  const filteredTools = useMemo(() => {
    const q = toolSearchQuery.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter((t) => t.name.toLowerCase().includes(q) || (t.protocol?.toLowerCase().includes(q)));
  }, [tools, toolSearchQuery]);

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
          Drag tools onto canvas or click to add.
        </p>
        <button
          type="button"
          className="button"
          onClick={() => setAddNodeModalOpen(true)}
          style={{ fontSize: "0.82rem", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.35rem" }}
        >
          <Wrench size={14} /> Add tool
        </button>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => {
            const opts = getAgentGridOptions();
            const arranged = layoutNodesByGraph({
              items: nodes,
              getNodeId: (n) => n.id,
              edges: edges.map((e) => ({ source: e.source, target: e.target })),
              setPosition: (n, x, y) => ({ ...n, position: [x, y] as [number, number] }),
              options: { startX: opts.startX, startY: opts.startY, stepX: opts.stepX, stepY: opts.stepY },
            });
            onNodesEdgesChange(arranged, edges);
            if (onArrangeComplete) {
              setTimeout(() => onArrangeComplete(arranged, edges), 0);
            }
          }}
          style={{ fontSize: "0.82rem", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.35rem" }}
          title="Arrange nodes by flow (left to right; fan-outs stacked vertically)"
        >
          <LayoutGrid size={14} /> Arrange
        </button>
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
      {addNodeModalOpen && (
        <div
          className="add-node-modal nodrag nopan"
          role="dialog"
          aria-label="Add tool"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && setAddNodeModalOpen(false)}
        >
          <div className="add-node-modal-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="add-node-modal-title">Add tool</h3>
            <div className="add-node-modal-search-wrap">
              <Search size={18} className="add-node-modal-search-icon" aria-hidden />
              <input
                ref={addModalInputRef}
                type="search"
                className="add-node-modal-search-input"
                placeholder="Search (LLM, Input, Weather, …)"
                value={addModalQuery}
                onChange={(e) => setAddModalQuery(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="add-node-modal-list">
              {filteredAddableItems.length === 0 ? (
                <p className="add-node-modal-empty">No tools match your search.</p>
              ) : (
                filteredAddableItems.map((item) =>
                  item.kind === "node" ? (
                    <button
                      key={item.type}
                      type="button"
                      className="add-node-modal-item nodrag nopan"
                      onClick={() => { addNode(item.type); setAddNodeModalOpen(false); }}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </button>
                  ) : (
                    <button
                      key={item.toolId}
                      type="button"
                      className="add-node-modal-item nodrag nopan"
                      onClick={() => { addNode("tool", undefined, item.toolId); setAddNodeModalOpen(false); }}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </button>
                  )
                )
              )}
            </div>
            <div className="add-node-modal-footer">
              <button type="button" className="button button-secondary" onClick={() => setAddNodeModalOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {toolSearchOpen && (
        <div
          className="tool-picker-modal nodrag nopan"
          role="dialog"
          aria-label="Select tool"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && setToolSearchOpen(false)}
        >
          <div className="tool-picker-modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="tool-picker-search-wrap">
              <Search size={18} className="tool-picker-search-icon" aria-hidden />
              <input
                ref={toolSearchInputRef}
                type="search"
                className="tool-picker-search-input"
                placeholder="Search tools by name or protocol…"
                value={toolSearchQuery}
                onChange={(e) => setToolSearchQuery(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="tool-picker-list">
              {filteredTools.length === 0 ? (
                <p className="tool-picker-empty">
                  {tools.length === 0 ? "No tools in library." : "No tools match your search."}
                </p>
              ) : (
                filteredTools.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="tool-picker-item nodrag nopan"
                    onClick={() => {
                      addNode("tool", toolSearchPosition, t.id);
                      setToolSearchOpen(false);
                    }}
                  >
                    <Wrench size={16} className="tool-picker-item-icon" aria-hidden />
                    <span className="tool-picker-item-name">{t.name}</span>
                    {t.protocol && <span className="tool-picker-item-protocol">{t.protocol}</span>}
                  </button>
                ))
              )}
            </div>
            <div className="tool-picker-footer">
              <button type="button" className="button button-secondary" onClick={() => setToolSearchOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      <div ref={canvasWrapRef} className="canvas-react-flow-wrap" style={{ flex: 1, minWidth: 0 }}>
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
          noDragClassName="nodrag"
          noPanClassName="nopan"
          noWheelClassName="nowheel"
          minZoom={0.1}
          maxZoom={2}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          defaultEdgeOptions={edgeOptions}
          edgeTypes={edgeTypes}
          connectionLineStyle={{ stroke: "var(--primary)", strokeWidth: 2 }}
          onEdgeClick={onEdgeClick}
          onPaneClick={onPaneClick}
          onNodeDragStart={() => { isDraggingRef.current = true; }}
          onNodeDragStop={() => { isDraggingRef.current = false; }}
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
