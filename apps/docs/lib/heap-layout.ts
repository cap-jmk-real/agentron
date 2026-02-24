/**
 * LTR layered graph layout for heap viewer. Layout is driven by children:
 * bottom layer gets slots from node height + gap; parents are centered over their children.
 * No fixed step numbers; spacing is derived from node dimensions and gaps.
 */

export type LayeredLayoutOptions = {
  /** Origin for the first layer (root). */
  startX?: number;
  startY?: number;
  /** Node bounding box (used to derive spacing so nodes don't overlap). */
  nodeWidth?: number;
  nodeHeight?: number;
  /** Gaps between nodes (horizontal between layers, vertical within layer). */
  gapX?: number;
  gapY?: number;
  /** Vertical offset for parent so its center aligns with children center (e.g. nodeHeight/2). */
  parentCenterOffsetUp?: number;
};

/**
 * LTR layered layout: nodes in layers by edge direction. Children get vertical slots
 * (nodeHeight + gapY); parents are centered over their children. Overlap resolution
 * uses the same slot size so no fixed magic numbers.
 */
export function layoutNodesByGraph<T>(params: {
  items: T[];
  getNodeId: (item: T) => string;
  edges: { source: string; target: string }[];
  setPosition: (item: T, x: number, y: number) => T;
  options?: LayeredLayoutOptions;
}): T[] {
  const { items, getNodeId, edges, setPosition } = params;
  const nodeWidth = params.options?.nodeWidth ?? 260;
  const nodeHeight = params.options?.nodeHeight ?? 100;
  const gapX = params.options?.gapX ?? 80;
  const gapY = params.options?.gapY ?? 60;
  const startX = params.options?.startX ?? 40;
  const startY = params.options?.startY ?? 40;
  const parentOffsetUp = params.options?.parentCenterOffsetUp ?? nodeHeight / 2;

  const stepX = nodeWidth + gapX;
  const slotHeight = nodeHeight + gapY;
  /** Minimum vertical gap between nodes in overlap resolution (slightly larger than gapY to avoid overlap). */
  const minVerticalGap = gapY + Math.round(nodeHeight * 0.15);

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

  let feedbackEdge: { source: string; target: string } | null = null;
  if (remaining.length > 0) {
    const cycleEdges = remaining.flatMap((id) =>
      (successors.get(id) ?? [])
        .filter((t) => remaining.includes(t))
        .map((target) => ({ source: id, target }))
    );
    const visit = new Set<string>();
    const stack = new Set<string>();
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
      return false;
    }
    for (const id of remaining) {
      if (!visit.has(id) && dfs(id)) break;
    }
  }

  const inDegreeForLayers = new Map<string, number>();
  for (const id of ids) inDegreeForLayers.set(id, 0);
  type Edge = { source: string; target: string };
  const edgesList: Edge[] = edges as unknown as Edge[];
  const getSrcTgt = (e: Edge): { src: string; tgt: string } => ({
    src: e.source,
    tgt: e.target,
  });
  const fe = feedbackEdge;
  for (let i = 0; i < edgesList.length; i++) {
    const edge = edgesList[i];
    if (!edge) continue;
    const { src, tgt } = getSrcTgt(edge);
    if (!idToItem.has(src) || !idToItem.has(tgt) || src === tgt) continue;
    if (fe && src === fe.source && tgt === fe.target) continue;
    inDegreeForLayers.set(tgt, (inDegreeForLayers.get(tgt) ?? 0) + 1);
  }
  const topoForLayers: string[] = [];
  const q = ids.filter((id) => inDegreeForLayers.get(id) === 0);
  while (q.length > 0) {
    const n = q.shift()!;
    topoForLayers.push(n);
    for (let i = 0; i < edgesList.length; i++) {
      const edge = edgesList[i];
      if (!edge) continue;
      const { src, tgt } = getSrcTgt(edge);
      if (src !== n) continue;
      if (!idToItem.has(tgt)) continue;
      if (fe && src === fe.source && tgt === fe.target) continue;
      const d = inDegreeForLayers.get(tgt)! - 1;
      inDegreeForLayers.set(tgt, d);
      if (d === 0) q.push(tgt);
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
          yPos.set(cid, startY + index * slotHeight);
          index++;
        }
      }
    } else {
      for (const id of layerNodes) {
        const children = getChildrenInNextLayer(id);
        if (children.length > 0) {
          const childY = children.map((c) => yPos.get(c) ?? startY);
          const minChildY = Math.min(...childY);
          const maxChildY = Math.max(...childY);
          const centerY = (minChildY + maxChildY) / 2;
          yPos.set(id, centerY - parentOffsetUp);
        } else {
          yPos.set(id, startY);
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
      const myY = yPos.get(id) ?? startY;
      const bottom =
        children.length > 0
          ? Math.max(
              ...children.map((c) => subtreeBottom.get(c) ?? (yPos.get(c) ?? startY) + nodeHeight)
            )
          : myY + nodeHeight;
      subtreeBottom.set(id, bottom);
    }
  }

  const shiftSubtree = (id: string, delta: number) => {
    for (const d of getDescendants(id)) yPos.set(d, (yPos.get(d) ?? startY) + delta);
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
        const bottomA = subtreeBottom.get(a) ?? (yPos.get(a) ?? startY) + nodeHeight;
        const topB = yPos.get(b) ?? startY;
        if (topB < bottomA + minVerticalGap) {
          const delta = bottomA + minVerticalGap - topB;
          shiftSubtree(b, delta);
          subtreeBottom.set(b, (subtreeBottom.get(b) ?? topB + nodeHeight) + delta);
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
    const x = startX + l * stepX;
    const y = yPos.get(id) ?? startY;
    result.push(setPosition(item, x, y));
  }
  return result;
}
