/**
 * Canvas layout helpers so nodes in the node editor don't overlap.
 * Used by agent and workflow canvases.
 */

export type Position = { x: number; y: number };

export type GridLayoutOptions = {
  startX?: number;
  startY?: number;
  stepX?: number;
  stepY?: number;
  /** For row-major (vertical flow): columns per row. For column-major (horizontal flow): ignored in favor of rows. */
  cols?: number;
  /** For column-major (horizontal / left-to-right flow): nodes per column. When set, layout is LTR. */
  rows?: number;
};

const DEFAULT_AGENT_GRID = {
  startX: 100,
  startY: 80,
  stepX: 380,
  stepY: 220,
  rows: 4,
} as const;

const DEFAULT_WORKFLOW_GRID = {
  startX: 80,
  startY: 60,
  stepX: 300,
  stepY: 180,
  cols: 3,
} as const;

/**
 * Returns the position for the i-th node. Uses column-major (LTR) when rows is set, else row-major.
 */
export function getGridPosition(
  index: number,
  options: GridLayoutOptions = {}
): Position {
  const opts = { ...DEFAULT_AGENT_GRID, ...options };
  const { startX, startY, stepX, stepY, cols = 3, rows } = opts;
  if (rows != null && rows > 0) {
    const col = Math.floor(index / rows);
    const row = index % rows;
    return { x: startX + col * stepX, y: startY + row * stepY };
  }
  const col = index % cols;
  const row = Math.floor(index / cols);
  return { x: startX + col * stepX, y: startY + row * stepY };
}

/**
 * Returns the next grid position that does not overlap existing positions.
 * Uses a tolerance of ~40% of step size to consider a cell "occupied".
 */
export function getNextNodePosition(
  existingPositions: Position[],
  options: GridLayoutOptions = {}
): Position {
  const opts = { ...DEFAULT_AGENT_GRID, ...options };
  const { startX, startY, stepX, stepY, cols = 3, rows } = opts;
  const tolerance = Math.min(stepX, stepY) * 0.4;

  const cellOccupied = (cx: number, cy: number) =>
    existingPositions.some((p) => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      return Math.abs(dx) < tolerance && Math.abs(dy) < tolerance;
    });

  let index = 0;
  for (;;) {
    const col = rows != null && rows > 0 ? Math.floor(index / rows) : index % cols;
    const row = rows != null && rows > 0 ? index % rows : Math.floor(index / cols);
    const x = startX + col * stepX;
    const y = startY + row * stepY;
    if (!cellOccupied(x, y)) return { x, y };
    index++;
  }
}

/**
 * Options for agent canvas grid (larger nodes).
 */
export function getAgentGridOptions(): GridLayoutOptions {
  return { ...DEFAULT_AGENT_GRID };
}

/**
 * Options for workflow canvas grid.
 */
export function getWorkflowGridOptions(): GridLayoutOptions {
  return { ...DEFAULT_WORKFLOW_GRID };
}

function overlaps(
  pos: [number, number],
  existing: Position[],
  tolerance: number
): boolean {
  return existing.some(
    (p) =>
      Math.abs(p.x - pos[0]) < tolerance && Math.abs(p.y - pos[1]) < tolerance
  );
}

/**
 * Assigns non-overlapping grid positions to nodes. Uses LTR column-major grid when options.rows is set.
 * Preserves existing positions that are valid and don't overlap; fills in the rest in grid order.
 */
export function layoutNodesWithoutOverlap<T>(
  items: T[],
  getPosition: (item: T) => [number, number] | undefined,
  setPosition: (item: T, x: number, y: number) => T,
  options: GridLayoutOptions = {}
): T[] {
  const opts = { ...DEFAULT_AGENT_GRID, ...options };
  const { stepX, stepY } = opts;
  const tolerance = Math.min(stepX, stepY) * 0.45;

  const positions: Position[] = [];
  const result: T[] = [];

  for (const item of items) {
    const pos = getPosition(item);
    let x: number;
    let y: number;

    if (
      Array.isArray(pos) &&
      pos.length >= 2 &&
      Number.isFinite(pos[0]) &&
      Number.isFinite(pos[1]) &&
      !overlaps(pos, positions, tolerance)
    ) {
      x = pos[0];
      y = pos[1];
    } else {
      const next = getNextNodePosition(positions, opts);
      x = next.x;
      y = next.y;
    }

    positions.push({ x, y });
    result.push(setPosition(item, x, y));
  }

  return result;
}

export type LayeredLayoutOptions = {
  startX?: number;
  startY?: number;
  stepX?: number;
  stepY?: number;
  /** Set so the parent's vertical center aligns with the center of its children: use parentHeight/2 (React Flow positions by top-left). */
  parentCenterOffsetUp?: number;
};

/**
 * LTR layered layout using the graph: nodes are assigned to layers by edge direction (source → target).
 * Layer 0 = no incoming edges; each next layer is one step to the right. Parents are vertically
 * centered over their fan-out (children), so e.g. one LLM → three tools has the LLM in the middle
 * of the three tools. Within-layer overlaps are resolved so nodes stay at least stepY apart.
 */
export function layoutNodesByGraph<T>(params: {
  items: T[];
  getNodeId: (item: T) => string;
  edges: { source: string; target: string }[];
  setPosition: (item: T, x: number, y: number) => T;
  options?: LayeredLayoutOptions;
}): T[] {
  const { items, getNodeId, edges, setPosition } = params;
  const parentOffsetUp = params.options?.parentCenterOffsetUp ?? 55;
  const opts = {
    startX: params.options?.startX ?? DEFAULT_AGENT_GRID.startX,
    startY: params.options?.startY ?? DEFAULT_AGENT_GRID.startY,
    stepX: params.options?.stepX ?? DEFAULT_AGENT_GRID.stepX,
    stepY: params.options?.stepY ?? DEFAULT_AGENT_GRID.stepY,
  };

  const idToItem = new Map<string, T>();
  for (const item of items) {
    idToItem.set(getNodeId(item), item);
  }
  const ids = [...idToItem.keys()];
  const incoming = new Map<string, string[]>();
  const successors = new Map<string, string[]>();
  for (const id of ids) {
    incoming.set(id, []);
    successors.set(id, []);
  }
  for (const e of edges) {
    if (idToItem.has(e.source) && idToItem.has(e.target) && e.source !== e.target) {
      incoming.get(e.target)!.push(e.source);
      successors.get(e.source)!.push(e.target);
    }
  }

  const inDegree = new Map<string, number>();
  for (const id of ids) inDegree.set(id, 0);
  for (const e of edges) {
    if (idToItem.has(e.source) && idToItem.has(e.target) && e.source !== e.target) {
      inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    }
  }

  const topo: string[] = [];
  const queue = ids.filter((id) => inDegree.get(id) === 0);
  while (queue.length > 0) {
    const n = queue.shift()!;
    topo.push(n);
    for (const e of edges) {
      if (e.source !== n) continue;
      if (!idToItem.has(e.target)) continue;
      const d = inDegree.get(e.target)! - 1;
      inDegree.set(e.target, d);
      if (d === 0) queue.push(e.target);
    }
  }
  const remaining = ids.filter((id) => !topo.includes(id));

  // For cycle nodes: find one feedback edge so we can assign layers in DAG order and avoid same-layer overlap.
  let feedbackEdge: { source: string; target: string } | null = null;
  if (remaining.length > 0) {
    const cycleEdges = remaining.flatMap((id) => (successors.get(id) ?? []).filter((t) => remaining.includes(t)).map((target) => ({ source: id, target })));
    const visit = new Set<string>();
    const stack = new Set<string>();
    const postOrder: string[] = [];
    function dfs(u: string): boolean {
      visit.add(u);
      stack.add(u);
      for (const e of cycleEdges) {
        if (e.source !== u) continue;
        const v = e.target;
        if (!visit.has(v)) {
          if (dfs(v)) return true;
        } else if (stack.has(v)) {
          feedbackEdge = { source: u, target: v };
          return true;
        }
      }
      stack.delete(u);
      postOrder.push(u);
      return false;
    }
    for (const id of remaining) {
      if (!visit.has(id) && dfs(id)) break;
    }
  }

  const inDegreeForLayers = new Map<string, number>();
  for (const id of ids) inDegreeForLayers.set(id, 0);
  type Edge = { source: string; target: string };
  const edgesArr: Edge[] = edges as Edge[];
  for (const e of edgesArr) {
    if (!idToItem.has(e.source) || !idToItem.has(e.target) || e.source === e.target) continue;
    if (feedbackEdge && e.source === feedbackEdge.source && e.target === feedbackEdge.target) continue;
    inDegreeForLayers.set(e.target, (inDegreeForLayers.get(e.target) ?? 0) + 1);
  }
  const topoForLayers: string[] = [];
  const q = ids.filter((id) => inDegreeForLayers.get(id) === 0);
  while (q.length > 0) {
    const n = q.shift()!;
    topoForLayers.push(n);
    for (const e of edgesArr) {
      if (e.source !== n) continue;
      if (!idToItem.has(e.target)) continue;
      if (feedbackEdge && e.source === feedbackEdge.source && e.target === feedbackEdge.target) continue;
      const d = inDegreeForLayers.get(e.target)! - 1;
      inDegreeForLayers.set(e.target, d);
      if (d === 0) q.push(e.target);
    }
  }
  const stillRemaining = ids.filter((id) => !topoForLayers.includes(id));
  for (const id of stillRemaining) topoForLayers.push(id);

  const layer = new Map<string, number>();
  for (const id of topoForLayers) {
    const preds = incoming.get(id) ?? [];
    const predLayers = preds
      .filter((p) => !(feedbackEdge && id === feedbackEdge.target && p === feedbackEdge.source))
      .map((p) => layer.get(p) ?? 0);
    const l = predLayers.length === 0 ? 0 : 1 + Math.max(...predLayers);
    layer.set(id, l);
  }

  const byLayer = new Map<number, string[]>();
  for (const id of ids) {
    const l = layer.get(id) ?? 0;
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l)!.push(id);
  }
  const layerIndices = [...byLayer.keys()].sort((a, b) => a - b);
  for (const l of layerIndices) {
    byLayer.get(l)!.sort();
  }

  const yPos = new Map<string, number>();

  const getChildrenInNextLayer = (id: string) =>
    (successors.get(id) ?? []).filter((c) => layer.get(c) === (layer.get(id) ?? 0) + 1);

  for (let li = layerIndices.length - 1; li >= 0; li--) {
    const l = layerIndices[li];
    const layerNodes = byLayer.get(l)!;

    if (li === layerIndices.length - 1) {
      const parentOf = (id: string) => (incoming.get(id) ?? [])[0];
      const byParent = new Map<string, string[]>();
      for (const id of layerNodes) {
        const p = parentOf(id);
        const key = p ?? id;
        if (!byParent.has(key)) byParent.set(key, []);
        byParent.get(key)!.push(id);
      }
      const parentIds = [...byParent.keys()].sort();
      let index = 0;
      for (const pid of parentIds) {
        const children = byParent.get(pid)!.sort();
        for (const cid of children) {
          yPos.set(cid, opts.startY + index * opts.stepY);
          index++;
        }
      }
    } else {
      for (const id of layerNodes) {
        const children = getChildrenInNextLayer(id);
        if (children.length > 0) {
          const childY = children.map((c) => yPos.get(c) ?? opts.startY);
          const minChildY = Math.min(...childY);
          const maxChildY = Math.max(...childY);
          const centerY = (minChildY + maxChildY) / 2;
          yPos.set(id, centerY - parentOffsetUp);
        } else {
          yPos.set(id, opts.startY);
        }
      }
    }
  }

  const subtreeBottom = new Map<string, number>();
  const getDescendants = (id: string): string[] => {
    const result = [id];
    for (const c of getChildrenInNextLayer(id)) result.push(...getDescendants(c));
    return result;
  };
  for (let li = layerIndices.length - 1; li >= 0; li--) {
    const l = layerIndices[li];
    const layerNodes = byLayer.get(l)!;
    for (const id of layerNodes) {
      const children = getChildrenInNextLayer(id);
      const bottom = children.length > 0
        ? Math.max(...children.map((c) => subtreeBottom.get(c) ?? yPos.get(c) ?? opts.startY))
        : (yPos.get(id) ?? opts.startY);
      subtreeBottom.set(id, bottom);
    }
  }

  const minGap = opts.stepY * 0.3;
  const shiftSubtree = (id: string, delta: number) => {
    for (const d of getDescendants(id)) yPos.set(d, (yPos.get(d) ?? opts.startY) + delta);
  };
  const updateAncestorBottoms = (id: string, delta: number) => {
    for (const p of incoming.get(id) ?? []) {
      if (subtreeBottom.has(p)) {
        subtreeBottom.set(p, subtreeBottom.get(p)! + delta);
        updateAncestorBottoms(p, delta);
      }
    }
  };
  for (let li = 0; li < layerIndices.length; li++) {
    const layerNodes = byLayer.get(layerIndices[li])!;
    let changed = true;
    while (changed) {
      changed = false;
      const sorted = [...layerNodes].sort((a, b) => (yPos.get(a) ?? 0) - (yPos.get(b) ?? 0));
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i];
        const b = sorted[i + 1];
        const bottomA = subtreeBottom.get(a) ?? yPos.get(a) ?? opts.startY;
        const topB = yPos.get(b) ?? opts.startY;
        if (topB < bottomA + minGap) {
          const delta = bottomA + minGap - topB;
          shiftSubtree(b, delta);
          subtreeBottom.set(b, (subtreeBottom.get(b) ?? topB) + delta);
          updateAncestorBottoms(b, delta);
          changed = true;
          break;
        }
      }
    }
  }

  const result: T[] = [];
  for (const item of items) {
    const id = getNodeId(item);
    const l = layer.get(id) ?? 0;
    const x = opts.startX + l * opts.stepX;
    const y = yPos.get(id) ?? opts.startY;
    result.push(setPosition(item, x, y));
  }
  return result;
}
