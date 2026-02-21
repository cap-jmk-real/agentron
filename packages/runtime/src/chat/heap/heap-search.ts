/**
 * Recursive heap search: at each level the chooser sees at most HEAP_OPTIONS_CAP options.
 *
 * Time complexity: O(depthLimit × |topLevelIds|) per path. With fixed depth limit (e.g. 5) and
 * |topLevelIds| ≤ n, this is O(n). Space O(depthLimit).
 */

import type { HeapStep } from "./types";
import type { SpecialistRegistry } from "./registry";
import { getOptionsAtNode, HEAP_OPTIONS_CAP } from "./registry";

export type ChooseFn = (optionIds: string[], depth: number) => string | null;

/**
 * Finds a path from root to a node at up to depthLimit by repeatedly asking the chooser (e.g. mocked LLM).
 * At each level gets at most HEAP_OPTIONS_CAP options; chooser returns one id or null to stop.
 * Returns the path of specialist ids from root to the chosen leaf, or to the last chosen node if stopped early.
 * Complexity: O(depthLimit × |topLevelIds|) — each step is getOptionsAtNode (O(|topLevelIds|) worst case) + one choose call.
 */
export function searchHeapPath(
  registry: SpecialistRegistry,
  depthLimit: number,
  choose: ChooseFn,
  optionsCap = HEAP_OPTIONS_CAP
): string[] {
  const path: string[] = [];
  let nodeId: string | null = null;

  for (let depth = 0; depth <= depthLimit; depth++) {
    const options = getOptionsAtNode(registry, nodeId, optionsCap);
    if (options.length === 0) break;
    const chosen = choose(options, depth);
    if (chosen === null || !options.includes(chosen)) break;
    path.push(chosen);
    nodeId = chosen;
  }

  return path;
}

/**
 * Finds a path from a given node (not root) to a leaf or up to depthLimit.
 * At each level gets options at the current node; chooser returns one id or null to stop.
 * If stopAtLeaf is true, stops when the chosen node has its own toolNames (is a leaf).
 */
export function searchFromNode(
  registry: SpecialistRegistry,
  startNodeId: string,
  depthLimit: number,
  choose: ChooseFn,
  optionsCap = HEAP_OPTIONS_CAP,
  stopAtLeaf = true
): string[] {
  const path: string[] = [];
  let nodeId: string | null = startNodeId;

  for (let depth = 0; depth <= depthLimit; depth++) {
    const options = getOptionsAtNode(registry, nodeId, optionsCap);
    if (options.length === 0) break;
    const chosen = choose(options, depth);
    if (chosen === null || !options.includes(chosen)) break;
    path.push(chosen);
    if (stopAtLeaf) {
      const entry = registry.specialists[chosen];
      if (entry && entry.toolNames.length > 0) break;
    }
    nodeId = chosen;
  }

  return path;
}

/** True if the specialist is a delegator (no toolNames, has delegateTargets). */
export function isDelegator(registry: SpecialistRegistry, specialistId: string): boolean {
  const entry = registry.specialists[specialistId];
  return !!(entry && entry.toolNames.length === 0 && entry.delegateTargets && entry.delegateTargets.length > 0);
}

export type ChooseFnAsync = (optionIds: string[], task: string, parentId: string) => Promise<string | null>;

/**
 * Expands priorityOrder so each delegator is replaced by a leaf via repeated choose (e.g. LLM).
 * For each step id that is a delegator, calls choose(options, task, parentId) and replaces id with the chosen child until a leaf or depth limit.
 */
export async function expandToLeaves(
  priorityOrder: HeapStep[],
  registry: SpecialistRegistry,
  refinedTask: string,
  choose: ChooseFnAsync,
  depthLimit = 5
): Promise<HeapStep[]> {
  const result: HeapStep[] = [];

  for (const step of priorityOrder) {
    if (typeof step === "string") {
      let id = step;
      let depth = 0;
      while (isDelegator(registry, id) && depth < depthLimit) {
        const options = getOptionsAtNode(registry, id);
        if (options.length === 0) break;
        const chosen = await choose(options, refinedTask, id);
        if (chosen === null || !options.includes(chosen)) break;
        id = chosen;
        depth += 1;
      }
      result.push(id);
    } else if (step && typeof step === "object" && Array.isArray(step.parallel)) {
      const expanded: string[] = [];
      for (const id of step.parallel) {
        let current = id;
        let depth = 0;
        while (isDelegator(registry, current) && depth < depthLimit) {
          const options = getOptionsAtNode(registry, current);
          if (options.length === 0) break;
          const chosen = await choose(options, refinedTask, current);
          if (chosen === null || !options.includes(chosen)) break;
          current = chosen;
          depth += 1;
        }
        expanded.push(current);
      }
      if (expanded.length > 0) result.push({ parallel: expanded });
    }
  }

  return result;
}
