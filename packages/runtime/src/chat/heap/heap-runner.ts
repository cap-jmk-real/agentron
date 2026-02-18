/**
 * Heap runner: builds a DAG from priorityOrder (programmatically, no LLM), then runs level by level.
 * When a specialist returns delegateHeap, runs the delegate DAG (depth limit), then continues.
 */

import type { SpecialistRegistry } from "./registry";
import type { HeapStep, SpecialistResult, HeapContextSummary, HeapDAG } from "./types";
import { buildHeapDAG } from "./heap-dag";

/** Max nesting depth for delegate heaps. Depth 0 = top-level heap; each delegation increments depth. So limit 5 = 6 levels total (top + 5 nested sub-heaps). */
export const DEFAULT_HEAP_DEPTH_LIMIT = 5;

export interface RunSpecialistFn {
  (specialistId: string, task: string, context: HeapContextSummary): Promise<SpecialistResult>;
}

export interface HeapRunnerOptions {
  depthLimit?: number;
  traceId?: string;
  /** Optional logger: (msg, data?) => void for [assistant] traceId= phase=... */
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

/** Merge new step outcome into context summary; cap total lines or length. */
function appendContext(
  context: HeapContextSummary,
  specialistId: string,
  outcome: string,
  maxSteps = 10
): HeapContextSummary {
  const steps = [...(context.steps ?? []), { specialistId, outcome }].slice(-maxSteps);
  return { ...context, steps };
}

/**
 * Runs a heap DAG level by level. For each level runs all specialists in parallel; handles delegateHeap by running sub-DAG (depth limit).
 */
export async function runHeapFromDAG(
  dag: HeapDAG,
  refinedTask: string,
  runSpecialist: RunSpecialistFn,
  registry: SpecialistRegistry,
  options: HeapRunnerOptions & { depth?: number; initialContext?: HeapContextSummary } = {}
): Promise<{ summary: string; context: HeapContextSummary }> {
  const depthLimit = options.depthLimit ?? DEFAULT_HEAP_DEPTH_LIMIT;
  const depth = options.depth ?? 0;
  const traceId = options.traceId;
  const log = options.log;

  let context: HeapContextSummary = options.initialContext ?? { steps: [] };
  const outcomes: string[] = [];

  for (let levelIndex = 0; levelIndex < dag.levels.length; levelIndex++) {
    const level = dag.levels[levelIndex];
    if (level.length === 0) continue;

    log?.("[assistant] heap DAG level", { traceId, phase: "heap", levelIndex, specialistIds: level, depth });
    const results = await Promise.all(
      level.map((id) => runSpecialist(id, refinedTask, context))
    );

    for (let i = 0; i < level.length; i++) {
      const id = level[i];
      const r = results[i];
      context = appendContext(context, id, r.summary);
      outcomes.push(r.summary);

      if (r.delegateHeap && depth < depthLimit) {
        const subDag = buildHeapDAG(r.delegateHeap, registry);
        if (subDag.levels.length > 0) {
          log?.("[assistant] delegate heap", {
            traceId,
            phase: "delegate",
            specialistId: id,
            delegateHeap: r.delegateHeap,
            depth: depth + 1,
          });
          const sub = await runHeapFromDAG(subDag, r.delegateTask ?? refinedTask, runSpecialist, registry, {
            ...options,
            depth: depth + 1,
            initialContext: context,
          });
          context = sub.context;
          outcomes.push(sub.summary);
        }
      }
    }
  }

  const summary = outcomes.length > 0 ? outcomes[outcomes.length - 1] : "No steps run.";
  return { summary, context };
}

/**
 * Builds a DAG from priorityOrder (programmatically, no LLM) and runs it. Empty route uses fallback specialist.
 */
export async function runHeap(
  priorityOrder: HeapStep[],
  refinedTask: string,
  runSpecialist: RunSpecialistFn,
  registry: SpecialistRegistry,
  options: HeapRunnerOptions = {}
): Promise<{ summary: string; context: HeapContextSummary }> {
  const log = options.log;
  const traceId = options.traceId;
  const dag = buildHeapDAG(priorityOrder, registry);

  if (dag.levels.length === 0) {
    const fallback = registry.topLevelIds[0];
    if (fallback) {
      log?.("[assistant] heap empty after DAG build, using fallback specialist", {
        traceId,
        phase: "heap",
        fallback,
      });
      const result = await runSpecialist(fallback, refinedTask, { steps: [] });
      return {
        summary: result.summary,
        context: appendContext({ steps: [] }, fallback, result.summary),
      };
    }
    return { summary: "No specialists available.", context: { steps: [] } };
  }

  return runHeapFromDAG(dag, refinedTask, runSpecialist, registry, { ...options, depth: 0 });
}
