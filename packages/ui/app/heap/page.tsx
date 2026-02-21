"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Loader2, RefreshCw, ChevronDown, ChevronRight, Layers, Network } from "lucide-react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { CanvasNodeCard } from "../components/canvas-node-card";
import { layoutNodesByGraph } from "../lib/canvas-layout";

type SpecialistEntry = {
  id: string;
  description?: string;
  toolNames: string[];
  delegateTargets?: string[];
  optionGroups?: Record<string, { label: string; toolIds: string[] }>;
};

type HeapSnapshot = {
  topLevelIds: string[];
  specialists: SpecialistEntry[];
  overlayIds: string[];
};

const HEAP_ROOT_ID = "__heap_root__";

type HeapNodeData = { id: string; isTopLevel: boolean; isOverlay: boolean; toolNames: string[]; isRoot?: boolean };

function HeapFlowNode({ data, selected }: NodeProps<Node<HeapNodeData>>) {
  const tools = data.toolNames ?? [];
  const isRoot = data.isRoot === true;
  return (
    <CanvasNodeCard
      icon={<Network size={14} className="heap-header-icon" />}
      label={isRoot ? "Heap" : "Specialist"}
      selected={selected}
      handleLeft
      handleRight
      minWidth={260}
      maxWidth={260}
    >
      <code className="heap-flow-node-id">{isRoot ? "Agentron Heap" : data.id}</code>
      {!isRoot && (
        <div className="heap-flow-node-badges">
          {data.isTopLevel && <span className="heap-badge heap-badge-top">top</span>}
          {data.isOverlay && <span className="heap-badge heap-badge-overlay">overlay</span>}
        </div>
      )}
      {!isRoot && tools.length > 0 && (
        <div className="heap-flow-node-tools" title={tools.join(", ")}>
          <span className="heap-flow-node-tools-label">{tools.length} tool{tools.length !== 1 ? "s" : ""}</span>
          <div className="heap-flow-node-tools-list">
            {tools.map((t) => (
              <code key={t} className="heap-list-card-tool-tag">{t}</code>
            ))}
          </div>
        </div>
      )}
    </CanvasNodeCard>
  );
}

const heapNodeTypes = { heap: HeapFlowNode };

/** Id that is a subspecialist of another top-level (e.g. improve_agents_workflows__part1 under improve_agents_workflows). */
function getParentInTopLevel(id: string, topLevelIds: string[]): string | null {
  for (const p of topLevelIds) {
    if (p !== id && id.startsWith(p + "_")) return p;
  }
  return null;
}

function HeapCanvas({ data }: { data: HeapSnapshot }) {
  const specialistsById = new Map(data.specialists.map((s) => [s.id, s]));
  const allIds = useMemo(() => {
    const set = new Set<string>([HEAP_ROOT_ID]);
    function add(id: string) {
      if (set.has(id)) return;
      set.add(id);
      const entry = specialistsById.get(id);
      entry?.delegateTargets?.forEach(add);
    }
    data.topLevelIds.forEach(add);
    return [...set];
  }, [data.topLevelIds, data.specialists]);
  const edges = useMemo(() => {
    const out: { source: string; target: string }[] = [];
    const topLevelIds = data.topLevelIds;
    const primary = topLevelIds.filter((id) => !getParentInTopLevel(id, topLevelIds));
    primary.forEach((id) => out.push({ source: HEAP_ROOT_ID, target: id }));
    topLevelIds.forEach((id) => {
      const parent = getParentInTopLevel(id, topLevelIds);
      if (parent && allIds.includes(parent)) out.push({ source: parent, target: id });
    });
    allIds.forEach((id) => {
      if (id === HEAP_ROOT_ID) return;
      specialistsById.get(id)?.delegateTargets?.forEach((t) => {
        if (allIds.includes(t) && !out.some((e) => e.source === id && e.target === t)) {
          out.push({ source: id, target: t });
        }
      });
    });
    return out;
  }, [allIds, data.specialists, data.topLevelIds]);
  const itemsWithPosition = useMemo(() => {
    type Item = { id: string; x?: number; y?: number };
    const items: Item[] = allIds.map((id) => ({ id }));
    return layoutNodesByGraph<Item>({
      items,
      getNodeId: (i) => i.id,
      edges,
      setPosition: (item, x, y) => ({ ...item, x, y }),
      options: {
        startX: 80,
        startY: 60,
        stepX: 380,
        stepY: 280,
        parentCenterOffsetUp: 60,
      },
    });
  }, [allIds, edges]);
  const initialNodes: Node<HeapNodeData>[] = itemsWithPosition.map((n) => {
    if (n.id === HEAP_ROOT_ID) {
      return {
        id: HEAP_ROOT_ID,
        type: "heap",
        position: { x: n.x ?? 0, y: n.y ?? 0 },
        data: { id: HEAP_ROOT_ID, isTopLevel: false, isOverlay: false, toolNames: [], isRoot: true },
      };
    }
    const entry = specialistsById.get(n.id);
    return {
      id: n.id,
      type: "heap",
      position: { x: n.x ?? 0, y: n.y ?? 0 },
      data: {
        id: n.id,
        isTopLevel: data.topLevelIds.includes(n.id),
        isOverlay: data.overlayIds.includes(n.id),
        toolNames: entry?.toolNames ?? [],
      },
    };
  });
  const initialEdges: Edge[] = edges.map((e, i) => ({ id: `e-${i}-${e.source}-${e.target}`, source: e.source, target: e.target }));
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edgesState, , onEdgesChange] = useEdgesState(initialEdges);
  return (
    <div className="heap-canvas-wrap">
      <ReactFlow
        nodes={nodes}
        edges={edgesState}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={heapNodeTypes}
        minZoom={0.1}
        maxZoom={2}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export default function HeapPage() {
  const [data, setData] = useState<HeapSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"canvas" | "list">("canvas");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/heap", { cache: "no-store" });
      if (!res.ok) {
        const t = await res.text();
        setError(t || "Failed to load heap");
        setData(null);
        return;
      }
      const json = (await res.json()) as HeapSnapshot;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load heap");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const specialistsById = useMemo(
    () => (data ? new Map(data.specialists.map((s) => [s.id, s])) : new Map<string, SpecialistEntry>()),
    [data]
  );

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading && !data) {
    return (
      <div className="heap-loading">
        <Loader2 size={20} className="spin" />
        <span>Loading heap…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="heap-error-wrap">
        <div className="heap-error-message">{error}</div>
        <button type="button" onClick={load} className="heap-retry-btn">
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="heap-page">
      <div className="heap-header">
        <Layers size={24} className="heap-header-icon" />
        <div>
          <h1 className="heap-title">Agentron Heap</h1>
          <p className="heap-description">
            Specialist registry as a tree (canvas). Switch to list view for full details.
          </p>
        </div>
        <div className="heap-view-toggle">
          <span className="heap-view-toggle-label">View:</span>
          <button
            type="button"
            onClick={() => setView("canvas")}
            className={`heap-view-btn ${view === "canvas" ? "active" : ""}`}
          >
            <Network size={12} /> Canvas
          </button>
          <button
            type="button"
            onClick={() => setView("list")}
            className={`heap-view-btn ${view === "list" ? "active" : ""}`}
          >
            List
          </button>
        </div>
        <button type="button" onClick={load} disabled={loading} className="heap-refresh-btn">
          <RefreshCw size={14} className={loading ? "spin" : ""} />
          Refresh
        </button>
      </div>

      {view === "canvas" && (
        <section className="heap-section">
          <h2 className="heap-section-title">Heap canvas</h2>
          <ReactFlowProvider key={data.topLevelIds.join(",") + "-" + data.specialists.length}>
            <HeapCanvas data={data} />
          </ReactFlowProvider>
        </section>
      )}
      {view === "list" && (
        <section className="heap-section">
          <h2 className="heap-section-title">
            Specialists ({data.specialists.length})
            {data.overlayIds.length > 0 && (
              <span className="heap-section-title-meta">(overlay: {data.overlayIds.join(", ")})</span>
            )}
          </h2>
          <div className="heap-list">
            {data.specialists.map((s) => {
              const isTopLevel = data.topLevelIds.includes(s.id);
              const isOverlay = data.overlayIds.includes(s.id);
              const expanded = expandedIds.has(s.id);
              const hasDetails =
                (s.toolNames?.length ?? 0) > 0 ||
                (s.optionGroups && Object.keys(s.optionGroups).length > 0) ||
                (s.delegateTargets?.length ?? 0) > 0;

              return (
                <div key={s.id} className="heap-list-card">
                  <button
                    type="button"
                    onClick={() => hasDetails && toggleExpanded(s.id)}
                    className={`heap-list-card-btn ${hasDetails ? "clickable" : ""}`}
                  >
                    {hasDetails ? (
                      expanded ? (
                        <ChevronDown size={16} className="heap-list-card-chevron" />
                      ) : (
                        <ChevronRight size={16} className="heap-list-card-chevron" />
                      )
                    ) : (
                      <span className="heap-list-card-spacer" />
                    )}
                    <code className="heap-list-card-id">{s.id}</code>
                    {isTopLevel && <span className="heap-badge heap-badge-top">top-level</span>}
                    {isOverlay && <span className="heap-badge heap-badge-overlay">overlay</span>}
                    {s.description && <span className="heap-list-card-desc">{s.description}</span>}
                  </button>
                  {expanded && hasDetails && (
                    <div className="heap-list-card-body">
                      {s.toolNames && s.toolNames.length > 0 && (
                        <div className="heap-list-card-body-section">
                          <div className="heap-list-card-body-title">Tools ({s.toolNames.length})</div>
                          <div className="heap-list-card-tools">
                            {s.toolNames.map((t) => (
                              <code key={t} className="heap-list-card-tool-tag">
                                {t}
                              </code>
                            ))}
                          </div>
                        </div>
                      )}
                      {s.optionGroups && Object.keys(s.optionGroups).length > 0 && (
                        <div className="heap-list-card-body-section">
                          <div className="heap-list-card-body-title">Option groups</div>
                          <div className="heap-list-card-option-groups">
                            {Object.entries(s.optionGroups).map(([key, grp]) => (
                              <div key={key} className="heap-list-card-option-row">
                                <span className="heap-list-card-option-key">{key}</span>
                                <span className="heap-list-card-desc">— {grp.label}</span>
                                <div className="heap-list-card-option-tools">
                                  {grp.toolIds.map((tid) => (
                                    <code key={tid} className="heap-list-card-option-tool-id">
                                      {tid}
                                    </code>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {s.delegateTargets && s.delegateTargets.length > 0 && (
                        <div className="heap-list-card-body-section">
                          <div className="heap-list-card-body-title">Delegates</div>
                          <div className="heap-list-card-delegates">
                            {s.delegateTargets.map((d) => (
                              <code key={d} className="heap-list-card-delegate-id">{d}</code>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
