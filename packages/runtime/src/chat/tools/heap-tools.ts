import type { AssistantToolDef } from "./types";

/** Tools for (a) session-only and (b) heap improvers. */
export const HEAP_TOOLS: AssistantToolDef[] = [
  {
    name: "apply_session_override",
    description: "(a) Session-only: apply a suggestion to the current run or conversation without persisting to DB. Use after observing run/feedback to suggest prompt or workflow tweaks for this run only. Scope is either this run (runId) or this conversation (conversationId).",
    parameters: {
      type: "object",
      properties: {
        scopeKey: { type: "string", description: "runId or conversationId to scope the override to." },
        overrideType: { type: "string", description: "e.g. prompt_override, workflow_override." },
        payload: { type: "object", description: "JSON object describing the override (e.g. { systemPrompt: \"...\" })." },
      },
      required: ["scopeKey", "overrideType", "payload"],
    },
  },
  {
    name: "list_specialists",
    description: "(b) Heap: list all specialists in the registry (id and description). Use to see current heap before register_specialist or update_specialist. Only available in heap mode.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "register_specialist",
    description: "(b) Heap: add a new specialist to the registry. Persisted to .data; next heap run will see it. Id must be unique. Tool names must be existing tool ids (e.g. from list_tools).",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Unique specialist id (e.g. my_specialist)." },
        description: { type: "string", description: "One-line description for router/planner." },
        toolNames: { type: "array", items: { type: "string" }, description: "Tool names this specialist can use (max 10)." },
      },
      required: ["id", "description", "toolNames"],
    },
  },
  {
    name: "update_specialist",
    description: "(b) Heap: update an existing specialist (default or overlay) in the registry. Persisted for overlay specialists. Use to change description or tool names.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Specialist id to update." },
        description: { type: "string", description: "New one-line description (optional)." },
        toolNames: { type: "array", items: { type: "string" }, description: "New tool names (optional; max 10)." },
      },
      required: ["id"],
    },
  },
];
