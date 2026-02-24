"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
const STEP_X = 320;
const STEP_Y = 200;

function getParentInTopLevel(id: string, topLevelIds: string[]): string | null {
  for (const p of topLevelIds) {
    if (p !== id && id.startsWith(p + "_")) return p;
  }
  return null;
}

function simpleLayout(
  allIds: string[],
  edges: { source: string; target: string }[],
  specialistsById: Map<string, SpecialistEntry>,
  topLevelIds: string[],
  overlayIds: string[]
): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  const idSet = new Set(allIds);
  const successors = new Map<string, string[]>();
  for (const e of edges) {
    if (idSet.has(e.source) && idSet.has(e.target)) {
      if (!successors.has(e.source)) successors.set(e.source, []);
      successors.get(e.source)!.push(e.target);
    }
  }
  const layers: string[][] = [];
  const visited = new Set<string>();
  let frontier = [HEAP_ROOT_ID];
  while (frontier.length > 0) {
    layers.push([...frontier]);
    const next: string[] = [];
    for (const id of frontier) {
      visited.add(id);
      for (const t of successors.get(id) ?? []) {
        if (!visited.has(t)) next.push(t);
      }
    }
    frontier = [...new Set(next)];
  }
  for (let li = 0; li < layers.length; li++) {
    const row = layers[li]!;
    row.forEach((id, i) => {
      pos.set(id, { x: li * STEP_X, y: i * STEP_Y });
    });
  }
  return pos;
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
      style={{
        padding: "8px 12px",
        borderRadius: 8,
        background: "var(--nx-bg-secondary, #f5f5f5)",
        boxShadow: selected
          ? "0 0 0 2px var(--nx-accents-6, #0070f3)"
          : "0 2px 6px rgba(0,0,0,0.08)",
        minWidth: 220,
        maxWidth: 260,
      }}
    >
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
              style={{ fontSize: 10, padding: "2px 6px", background: "#e0e7ff", borderRadius: 4 }}
            >
              top
            </span>
          )}
          {data.isOverlay && (
            <span
              style={{ fontSize: 10, padding: "2px 6px", background: "#fef3c7", borderRadius: 4 }}
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
                style={{
                  fontSize: "0.65rem",
                  background: "#eee",
                  padding: "2px 4px",
                  borderRadius: 2,
                }}
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

  const { allIds, edges, positions } = useMemo(() => {
    if (!data)
      return {
        allIds: [] as string[],
        edges: [] as { source: string; target: string }[],
        positions: new Map<string, { x: number; y: number }>(),
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
    const positions = simpleLayout(
      allIds,
      edges,
      specialistsById,
      data.topLevelIds,
      data.overlayIds
    );
    return { allIds, edges, positions };
  }, [data, specialistsById]);

  const initialNodes: Node<HeapNodeData>[] = useMemo(() => {
    if (!data) return [];
    return allIds.map((id) => {
      const pos = positions.get(id) ?? { x: 0, y: 0 };
      if (id === HEAP_ROOT_ID) {
        return {
          id: HEAP_ROOT_ID,
          type: "heap",
          position: pos,
          data: {
            id: HEAP_ROOT_ID,
            isTopLevel: false,
            isOverlay: false,
            toolNames: [],
            isRoot: true,
          },
        };
      }
      const entry = specialistsById.get(id);
      return {
        id,
        type: "heap",
        position: pos,
        data: {
          id,
          isTopLevel: data.topLevelIds.includes(id),
          isOverlay: data.overlayIds.includes(id),
          toolNames: entry?.toolNames ?? [],
        },
      };
    });
  }, [data, allIds, positions, specialistsById]);

  const initialEdges: Edge[] = useMemo(
    () =>
      edges.map((e, i) => ({
        id: `e-${i}-${e.source}-${e.target}`,
        source: e.source,
        target: e.target,
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
