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

/**
 * True if the specialist is a delegator (no tools, has children).
 * End of a branch = specialist that has toolNames (a leaf). Traversal is deterministic:
 * at each delegator we ask the LLM which child to go to; we stop when we reach a specialist with tools.
 */
export function isDelegator(registry: SpecialistRegistry, specialistId: string): boolean {
  const entry = registry.specialists[specialistId];
  return !!(
    entry &&
    entry.toolNames.length === 0 &&
    entry.delegateTargets &&
    entry.delegateTargets.length > 0
  );
}

export type ChooseFnAsync = (
  optionIds: string[],
  task: string,
  parentId: string
) => Promise<string | string[] | null>;

/**
 * Expands priorityOrder so each delegator is replaced by a leaf (specialist with tools).
 * Recursive discovery: at each node that is a delegator (has children, no tools), we ask the LLM
 * which child to go to; we follow that choice until we reach a specialist that has tools (end of branch).
 * The LLM may return one or more ids to run in parallel at this step.
 */
export async function expandToLeaves(
  priorityOrder: HeapStep[],
  registry: SpecialistRegistry,
  refinedTask: string,
  choose: ChooseFnAsync,
  depthLimit = 5
): Promise<HeapStep[]> {
  const result: HeapStep[] = [];

  const expandOne = async (startId: string): Promise<string | string[]> => {
    let id = startId;
    let depth = 0;
    while (isDelegator(registry, id) && depth < depthLimit) {
      const options = getOptionsAtNode(registry, id);
      if (options.length === 0) break;
      const chosen = await choose(options, refinedTask, id);
      if (chosen === null) break;
      if (Array.isArray(chosen)) {
        const valid = chosen.filter((c) => options.includes(c));
        if (valid.length === 0) break;
        return valid.length === 1 ? valid[0] : valid;
      }
      if (!options.includes(chosen)) break;
      id = chosen;
      depth += 1;
    }
    return id;
  };

  for (const step of priorityOrder) {
    if (typeof step === "string") {
      const expanded = await expandOne(step);
      if (Array.isArray(expanded)) {
        result.push({ parallel: expanded });
      } else {
        result.push(expanded);
      }
    } else if (step && typeof step === "object" && Array.isArray(step.parallel)) {
      const expanded: string[] = [];
      for (const id of step.parallel) {
        const leaf = await expandOne(id);
        if (Array.isArray(leaf)) expanded.push(...leaf);
        else expanded.push(leaf);
      }
      if (expanded.length > 0) result.push({ parallel: expanded });
    }
  }

  return result;
}
