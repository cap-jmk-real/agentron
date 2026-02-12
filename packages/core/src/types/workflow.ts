import type { Canvas } from "./canvas";

export type ExecutionMode = "one_time" | "continuous" | "interval";

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
}
