/**
 * Heap (multi-agent) types: router output, steps, and specialist results.
 */

/** A single step: one specialist id, or a parallel group of specialist ids. */
export type HeapStep = string | { parallel: string[] };

/** Router output: ordered steps and refined task description. */
export interface RouterOutput {
  priorityOrder: HeapStep[];
  refinedTask: string;
}

/** Planner output: route plus extracted context and per-specialist instructions. */
export interface PlannerOutput {
  priorityOrder: HeapStep[];
  refinedTask: string;
  /** URLs, IDs, file paths etc. extracted from the user message. */
  extractedContext?: Record<string, unknown>;
  instructionsForGeneral?: string;
  instructionsForAgent?: string;
  instructionsForWorkflow?: string;
  /** improve_run: current run/session only (no DB). */
  instructionsForImproveRun?: string;
  /** improve_heap: registry, planner. */
  instructionsForImproveHeap?: string;
  /** improve_agents_workflows: workflow agents and workflows (studio DB). */
  instructionsForImproveAgentsWorkflows?: string;
  /** @deprecated Use instructionsForImproveAgentsWorkflows. Kept for backward compat. */
  instructionsForImprovement?: string;
  /** @deprecated Use instructionsForImproveRun. Kept for backward compat. */
  instructionsForImprovementSession?: string;
  /** @deprecated Use instructionsForImproveHeap. Kept for backward compat. */
  instructionsForImprovementHeap?: string;
}

/** Result from running one specialist. May include a sub-heap to run (delegation). */
export interface SpecialistResult {
  /** Short summary for context (1–2 lines). */
  summary: string;
  /** Optional sub-heap to run before continuing; step ids must be in delegator's delegateTargets. */
  delegateHeap?: HeapStep[];
  /** Optional task override for the delegate heap. */
  delegateTask?: string;
}

/** Structured context passed between heap steps (capped size). */
export interface HeapContextSummary {
  steps: { specialistId: string; outcome: string }[];
  /** Approximate token cap for total context from previous steps (e.g. 500). */
  maxTokens?: number;
}

/**
 * DAG built from priorityOrder: each level is an array of specialist ids to run in parallel.
 * Level 0 runs first, then level 1, etc. No LLM — built programmatically from the route.
 */
export interface HeapDAG {
  /** Levels in order; each level is specialist ids that can run in parallel. */
  levels: string[][];
}
