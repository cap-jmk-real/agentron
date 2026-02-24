"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { layoutNodesByGraph } from "../lib/heap-layout";

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

function getParentInTopLevel(id: string, topLevelIds: string[]): string | null {
  for (const p of topLevelIds) {
    if (p !== id && id.startsWith(p + "_")) return p;
  }
  return null;
}

type HeapNodeData = {
  id: string;
  isTopLevel: boolean;
  isOverlay: boolean;
  toolNames: string[];
  isRoot?: boolean;
};

function HeapNode({ data, selected }: NodeProps<Node<HeapNodeData>>) {
  const tools = data.toolNames ?? [];
  const isRoot = data.isRoot === true;
  return (
    <div
      className="heap-viewer-node"
      style={{
        position: "relative",
        padding: "8px 12px",
        borderRadius: 8,
        background: "var(--heap-node-bg, #f5f5f5)",
        boxShadow: selected
          ? "0 0 0 2px var(--nx-accents-6, #0070f3)"
          : "0 2px 6px rgba(0,0,0,0.08)",
        minWidth: 220,
        maxWidth: 260,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ width: 10, height: 10 }} />
      <Handle type="source" position={Position.Right} style={{ width: 10, height: 10 }} />
      <div
        style={{
          fontSize: "0.65rem",
          fontWeight: 600,
          color: "var(--nx-accents-5, #666)",
          marginBottom: 4,
        }}
      >
        {isRoot ? "Heap" : "Specialist"}
      </div>
      <code style={{ fontSize: "0.8rem", wordBreak: "break-all" }}>
        {isRoot ? "Agentron Heap" : data.id}
      </code>
      {!isRoot && (
        <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
          {data.isTopLevel && (
            <span
              className="heap-pill heap-pill-top"
              style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4 }}
            >
              top
            </span>
          )}
          {data.isOverlay && (
            <span
              className="heap-pill heap-pill-overlay"
              style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4 }}
            >
              overlay
            </span>
          )}
        </div>
      )}
      {!isRoot && tools.length > 0 && (
        <div style={{ marginTop: 6, fontSize: "0.7rem", color: "var(--nx-text-secondary, #666)" }}>
          <span style={{ fontWeight: 600 }}>
            {tools.length} tool{tools.length !== 1 ? "s" : ""}
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
            {tools.slice(0, 5).map((t) => (
              <code
                key={t}
                className="heap-tool-chip"
                style={{ fontSize: "0.65rem", padding: "2px 4px", borderRadius: 2 }}
              >
                {t}
              </code>
            ))}
            {tools.length > 5 && <span style={{ fontSize: "0.65rem" }}>+{tools.length - 5}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

const nodeTypes = { heap: HeapNode };

export function HeapViewer() {
  const [data, setData] = useState<HeapSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const base =
      (typeof document !== "undefined" && document.body.getAttribute("data-base-path")) || "";
    const url = `${base}/heap-snapshot.json`;
    setLoading(true);
    setError(null);
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText || "Failed to load heap");
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  const specialistsById = useMemo(
    () =>
      data ? new Map(data.specialists.map((s) => [s.id, s])) : new Map<string, SpecialistEntry>(),
    [data]
  );

  const { allIds, edges, itemsWithPosition } = useMemo(() => {
    if (!data)
      return {
        allIds: [] as string[],
        edges: [] as { source: string; target: string }[],
        itemsWithPosition: [] as { id: string; x?: number; y?: number }[],
      };
    const set = new Set<string>([HEAP_ROOT_ID]);
    function add(id: string) {
      if (set.has(id)) return;
      set.add(id);
      specialistsById.get(id)?.delegateTargets?.forEach(add);
    }
    data.topLevelIds.forEach(add);
    const allIds = [...set];
    const topLevelIds = data.topLevelIds;
    const primary = topLevelIds.filter((id) => !getParentInTopLevel(id, topLevelIds));
    const edges: { source: string; target: string }[] = [];
    primary.forEach((id) => edges.push({ source: HEAP_ROOT_ID, target: id }));
    topLevelIds.forEach((id) => {
      const parent = getParentInTopLevel(id, topLevelIds);
      if (parent && allIds.includes(parent)) edges.push({ source: parent, target: id });
    });
    allIds.forEach((id) => {
      if (id === HEAP_ROOT_ID) return;
      specialistsById.get(id)?.delegateTargets?.forEach((t) => {
        if (allIds.includes(t) && !edges.some((e) => e.source === id && e.target === t)) {
          edges.push({ source: id, target: t });
        }
      });
    });
    const items: { id: string; x?: number; y?: number }[] = allIds.map((id) => ({ id }));
    const itemsWithPosition = layoutNodesByGraph({
      items,
      getNodeId: (i) => i.id,
      edges,
      setPosition: (item, x, y) => ({ ...item, x, y }),
      options: {
        startX: 40,
        startY: 40,
        nodeWidth: 260,
        nodeHeight: 140,
        gapX: 80,
        gapY: 80,
      },
    });
    return { allIds, edges, itemsWithPosition };
  }, [data, specialistsById]);

  const initialNodes: Node<HeapNodeData>[] = useMemo(() => {
    if (!data) return [];
    return itemsWithPosition.map((n) => {
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      if (n.id === HEAP_ROOT_ID) {
        return {
          id: HEAP_ROOT_ID,
          type: "heap",
          position: { x, y },
          data: {
            id: HEAP_ROOT_ID,
            isTopLevel: false,
            isOverlay: false,
            toolNames: [],
            isRoot: true,
          },
        };
      }
      const entry = specialistsById.get(n.id);
      return {
        id: n.id,
        type: "heap",
        position: { x, y },
        data: {
          id: n.id,
          isTopLevel: data.topLevelIds.includes(n.id),
          isOverlay: data.overlayIds.includes(n.id),
          toolNames: entry?.toolNames ?? [],
        },
      };
    });
  }, [data, itemsWithPosition, specialistsById]);

  const initialEdges: Edge[] = useMemo(
    () =>
      edges.map((e, i) => ({
        id: `e-${i}-${e.source}-${e.target}`,
        source: e.source,
        target: e.target,
        style: { stroke: "#94a3b8", strokeWidth: 2 },
      })),
    [edges]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edgesState, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    if (data && initialNodes.length > 0) {
      setNodes(initialNodes);
      setEdges(initialEdges);
    }
  }, [data, initialNodes, initialEdges, setNodes, setEdges]);

  const onInit = useCallback(() => {}, []);

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "var(--nx-text-secondary)" }}>
        Loading heap…
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "var(--nx-error, #c00)" }}>
        {error}
      </div>
    );
  }
  if (!data) return null;

  return (
    <div
      className="heap-viewer-flow"
      style={{
        height: 420,
        width: "100%",
        minWidth: 300,
        border: "1px solid var(--nx-border)",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edgesState}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={{ style: { stroke: "#94a3b8", strokeWidth: 2 } }}
          minZoom={0.15}
          maxZoom={1.5}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          onInit={onInit}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
