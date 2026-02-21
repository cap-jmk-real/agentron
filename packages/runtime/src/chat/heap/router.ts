/**
 * Router contract: build prompt for the router LLM and parse its output (priorityOrder + refinedTask).
 * The actual LLM call is done by the caller (e.g. chat route).
 */

import type { RouterOutput, HeapStep } from "./types";
import type { SpecialistRegistry } from "./registry";

/** Max options the model sees at once. Deeper exploration is recursive via delegation (sub-heap), not by showing the full tree. */
export const ROUTER_OPTIONS_CAP = 10;

/**
 * Builds the router prompt: user message + list of top-level specialist ids (with optional descriptions).
 * Never shows more than ROUTER_OPTIONS_CAP options; further levels are reached by delegation at runtime.
 */
export function buildRouterPrompt(
  userMessage: string,
  registry: SpecialistRegistry,
  options?: { includeDescriptions?: boolean }
): string {
  const ids = registry.topLevelIds.slice(0, ROUTER_OPTIONS_CAP);
  const includeDescriptions = options?.includeDescriptions ?? true;
  const specialistList = ids
    .map((id) => {
      const entry = registry.specialists[id];
      const desc = includeDescriptions && entry?.description ? ` — ${entry.description}` : "";
      return `- ${id}${desc}`;
    })
    .join("\n");

  return `You are a router. The user message and available specialists are below.

Available specialists (choose one or more, in order; you may use parallel steps):
${specialistList}

Respond with exactly one JSON object, no other text, in this form:
{"priorityOrder": [...], "refinedTask": "..."}

Rules for priorityOrder:
- Each element is either a specialist id string (e.g. "workflow") or a parallel group: {"parallel": ["id1", "id2"]}.
- Only use ids from the list above.
- Order matters: steps run sequentially unless in a parallel group.
- Keep the list short (e.g. 1–3 steps).

refinedTask: a short, clear task description for the specialists (1–2 sentences).

User message:
---
${userMessage}
---`;
}

/**
 * Parses router LLM output into priorityOrder and refinedTask. Returns null if invalid.
 */
export function parseRouterOutput(text: string): RouterOutput | null {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    const order = obj.priorityOrder;
    const task = obj.refinedTask;
    if (!Array.isArray(order)) return null;
    if (typeof task !== "string") return null;
    const priorityOrder: HeapStep[] = [];
    for (const item of order) {
      if (typeof item === "string") {
        priorityOrder.push(item);
      } else if (
        item &&
        typeof item === "object" &&
        Array.isArray((item as { parallel?: unknown }).parallel)
      ) {
        const arr = (item as { parallel: unknown[] }).parallel.filter(
          (x): x is string => typeof x === "string"
        );
        if (arr.length > 0) priorityOrder.push({ parallel: arr });
      }
    }
    return { priorityOrder, refinedTask: task };
  } catch {
    return null;
  }
}
