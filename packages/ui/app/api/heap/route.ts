import { json } from "../_lib/response";
import { getRegistry, registryToSnapshot } from "@agentron-studio/runtime";
import { loadSpecialistOverrides } from "../_lib/specialist-overrides";

export const runtime = "nodejs";

/** Serializable snapshot of the heap registry for the Heap debug UI. Re-exported from runtime for route typing. */
export type HeapSnapshot = import("@agentron-studio/runtime").HeapSnapshot;

/**
 * GET /api/heap
 * Returns the current Agentron heap registry (default + overlay) for visualization and debugging.
 */
export async function GET() {
  const overrides = loadSpecialistOverrides();
  const registry = getRegistry(overrides);
  const overlayIds = overrides.map((e) => e.id);
  const snapshot = registryToSnapshot(registry, overlayIds);
  return json(snapshot);
}
