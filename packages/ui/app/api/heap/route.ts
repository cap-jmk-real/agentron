import { json } from "../_lib/response";
import { getRegistry } from "@agentron-studio/runtime";
import { loadSpecialistOverrides } from "../_lib/specialist-overrides";

export const runtime = "nodejs";

/** Serializable snapshot of the heap registry for the Heap debug UI. */
export type HeapSnapshot = {
  topLevelIds: string[];
  specialists: Array<{
    id: string;
    description?: string;
    toolNames: string[];
    delegateTargets?: string[];
    optionGroups?: Record<string, { label: string; toolIds: string[] }>;
  }>;
  /** Overlay specialists loaded from .data (custom/registered). */
  overlayIds: string[];
};

/**
 * GET /api/heap
 * Returns the current Agentron heap registry (default + overlay) for visualization and debugging.
 */
export async function GET() {
  const overrides = loadSpecialistOverrides();
  const registry = getRegistry(overrides);
  const overlayIds = overrides.map((e) => e.id);

  const specialists = registry.topLevelIds
    .flatMap((id) => {
      const entry = registry.specialists[id];
      if (!entry) return [];
      return [{ id, entry }];
    })
    .concat(
      Object.entries(registry.specialists)
        .filter(([id]) => !registry.topLevelIds.includes(id))
        .map(([id, entry]) => ({ id, entry }))
    )
    .map(({ id, entry }) => ({
      id,
      description: entry.description,
      toolNames: entry.toolNames ?? [],
      delegateTargets: entry.delegateTargets,
      optionGroups: entry.optionGroups
        ? Object.fromEntries(
            Object.entries(entry.optionGroups).map(([k, v]) => [k, { label: v.label, toolIds: v.toolIds ?? [] }])
          )
        : undefined,
    }));

  const snapshot: HeapSnapshot = {
    topLevelIds: registry.topLevelIds,
    specialists,
    overlayIds,
  };

  return json(snapshot);
}
