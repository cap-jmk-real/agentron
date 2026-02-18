import type { Canvas } from "./canvas";

export type ExecutionMode = "one_time" | "continuous" | "interval";

/**
 * One step in an explicit execution order: a single node id or a parallel group of node ids.
 * Mirrors the heap's HeapStep structure for leveled DAG execution.
 */
export type WorkflowExecutionStep = string | { parallel: string[] };

/** A single graph within a workflow. Can have its own schedule for periodic execution. */
export interface WorkflowBranch {
  id: string;
  name?: string;
  nodes: Canvas["nodes"];
  edges: Canvas["edges"];
  /** When set with edges, execution follows the graph and stops after this many full cycles. */
  maxRounds?: number | null;
  /** Schedule for this branch only: interval seconds (e.g. "60"), daily@HH:mm, or weekly@0,1,2 (0=Sun). */
  schedule?: string;
  executionMode?: ExecutionMode;
  /** Optional turn instruction for agents in this branch. */
  turnInstruction?: string | null;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  nodes: Canvas["nodes"];
  edges: Canvas["edges"];
  executionMode: ExecutionMode;
  schedule?: string;
  /** When set with edges, execution follows the graph and stops after this many full cycles (avoids endless loops). */
  maxRounds?: number | null;
  /** Optional instruction injected at the start of each agent turn (e.g. "Reply directly to what the partner just said."). Set via update_workflow turnInstruction. */
  turnInstruction?: string | null;
  /** Multiple disconnected graphs, each with its own schedule. When set, branches run in parallel according to their schedules; main nodes/edges remain for one-time or legacy runs. */
  branches?: WorkflowBranch[];
  /**
   * Optional explicit execution order: array of steps (node id or { parallel: nodeIds }).
   * When set, the engine runs levels in this order with parallel grouping; when omitted,
   * nodes run in array order (one per level). Mirrors heap's priorityOrder structure.
   */
  executionOrder?: WorkflowExecutionStep[] | null;
}
