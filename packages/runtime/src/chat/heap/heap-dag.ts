/**
 * Programmatic DAG construction from heap route (priorityOrder).
 * No LLM — purely deterministic from the router output and registry.
 */

import type { HeapStep } from "./types";
import type { SpecialistRegistry } from "./registry";

function isParallelStep(step: HeapStep): step is { parallel: string[] } {
  return typeof step === "object" && step !== null && Array.isArray((step as { parallel: string[] }).parallel);
}

function getStepIds(step: HeapStep): string[] {
  if (isParallelStep(step)) return step.parallel;
  return [step];
}

function validateIds(ids: string[], registry: SpecialistRegistry): string[] {
  return ids.filter((id) => id in registry.specialists);
}

/**
 * Builds a DAG from priorityOrder: each step becomes one level; parallel steps become multiple nodes at that level.
 * Validates all specialist ids against the registry; strips unknown ids.
 */
export function buildHeapDAG(
  priorityOrder: HeapStep[],
  registry: SpecialistRegistry
): { levels: string[][] } {
  const levels: string[][] = [];
  for (const step of priorityOrder) {
    const ids = getStepIds(step);
    const valid = validateIds(ids, registry);
    if (valid.length === 0) continue;
    levels.push(valid);
  }
  return { levels };
}
