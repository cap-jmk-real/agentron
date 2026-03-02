/**
 * n8n-style unified canvas format.
 * Single JSON structure for nodes (with position at top level) and edges.
 * Used for agent graphs and workflow graphs.
 *
 * @packageDocumentation
 */

/** [x, y] position of a node on the canvas. */
export type CanvasPosition = [x: number, y: number];

/** Transform configuration for input/output nodes. Supports {{ $input }} template. */
export type NodeTransform = {
  type?: "expression" | "passthrough";
  /** Template: {{ $input }} is replaced with JSON.stringify(input). */
  expression?: string;
};

/** A single node in a canvas graph: id, type, position, optional name and parameters. */
export type CanvasNode = {
  id: string;
  type: string;
  name?: string;
  position: CanvasPosition;
  /** Node-specific parameters (replaces legacy config for canvas-relevant fields) */
  parameters?: Record<string, unknown>;
};

/** Optional condition for conditional edges (e.g. steer by last message type or content). */
export type EdgeCondition =
  | {
      /** "message_type": last message role or type must equal value. */
      type: "message_type";
      value: string;
    }
  | {
      /** "content_contains": last output/message content must include value (case-insensitive). */
      type: "content_contains";
      value: string;
    };

/** Directed edge between two nodes; optional condition for conditional branching. */
export type CanvasEdge = {
  id: string;
  source: string;
  target: string;
  /** Optional aliases for source/target (e.g. React Flow style). */
  from?: string;
  to?: string;
  /** Optional: edge is taken only when condition evaluates true against last output/message. */
  condition?: EdgeCondition;
};

/** Unified canvas structure: nodes and edges. Single source of truth for agent/workflow graphs. */
export interface Canvas {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}
