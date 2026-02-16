/**
 * n8n-style unified canvas format.
 * Single JSON structure for nodes (with position at top level) and edges.
 */

export type CanvasPosition = [x: number, y: number];

/** Transform configuration for input/output nodes. Supports {{ $input }} template. */
export type NodeTransform = {
  type?: "expression" | "passthrough";
  /** Template: {{ $input }} is replaced with JSON.stringify(input). */
  expression?: string;
};

export type CanvasNode = {
  id: string;
  type: string;
  name?: string;
  position: CanvasPosition;
  /** Node-specific parameters (replaces legacy config for canvas-relevant fields) */
  parameters?: Record<string, unknown>;
};

export type CanvasEdge = {
  id: string;
  source: string;
  target: string;
  /** Optional aliases for source/target (e.g. React Flow style). */
  from?: string;
  to?: string;
};

/** Unified canvas structure - single source of truth for agent/workflow graphs. */
export interface Canvas {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}
