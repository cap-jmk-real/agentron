# Chat backend: heap, planning, and context

This document describes how the chat backend works when **heap mode** is enabled: the planner, the specialist heap, context passed to the planner and specialists, and how the message queue interacts with them. It is the single place to look for “how does the backend decide which specialist runs?” and “why didn’t the planner see the previous message?”.

## Overview

When heap mode is on, each user message is processed in a pipeline:

1. **Rephrase** (optional) — User message may be rephrased or classified.
2. **Planning** — One LLM call (the “planner”) receives the user message and optional recent conversation; it outputs a structured **plan**: which specialists to run (`priorityOrder`), a short task description (`refinedTask`), extracted values like URLs/IDs (`extractedContext`), and optional per-specialist instructions.
3. **Heap execution** — The heap runs specialists in the order given by the plan. Each specialist gets the refined task plus any plan instructions and extracted context. Specialists have limited tools (e.g. only `agent` can create agents).
4. **Response** — The last specialist’s summary (and any tool results like `ask_user`) is returned. If the turn ends with `ask_user`, the plan is stored as a **pending plan** for the next turn (continuation).

When heap mode is off, a single assistant handles the message with full history and tools (no planner, no heap).

## Heap

- **What it is:** A **specialist registry** of top-level ids (e.g. `general`, `workflow`, `agent`, `improve_run`, `improve_heap`, `improve_agents_workflows`). Each specialist has a description and a set of tool names (or option groups for improvers). Some entries are “delegators” (they have subspecialists); the rest are “leaves” that actually run with their tools.
- **How routing works:** The planner outputs `priorityOrder` (e.g. `["agent", "workflow"]` or `[{ "parallel": ["agent", "workflow"] }]`). The chat route may **expand to leaves** (replace delegators with a chosen leaf via a small LLM choose call). Then `runHeap` builds a DAG from `priorityOrder` and runs each level in sequence (or in parallel within a level).
- **Where the registry comes from:** `getRegistry(loadSpecialistOverrides())` in the chat route. Overrides can add or change specialists. The registry is in `packages/runtime/src/chat/heap/registry.ts` (default static registry) and used by `runHeap` in `packages/runtime/src/chat/heap/heap-runner.ts`.
- **Tools per specialist:** `getToolsForSpecialist(registry, specialistId)` returns the list of tool names that specialist is allowed to call. Only the **agent** specialist receives the full studio tool list (for `create_agent` etc.); others get a scoped list so they don’t see every native tool.

## Planning

- **Role:** One LLM call per turn. Inputs: user message, optional recent conversation context, list of specialists and their option groups. Output: a single JSON object with `priorityOrder`, `refinedTask`, `extractedContext`, and optional `instructionsForGeneral`, `instructionsForAgent`, etc.
- **Prompt:** Built by `buildPlannerPrompt(userMessage, registry, recentConversationContext)` in `packages/runtime/src/chat/heap/planner.ts`. The planner is instructed to preserve every URL and identifier in `extractedContext`.
- **Parsing:** `parsePlanOutput(text)` extracts the JSON from the planner’s reply. If the reply is empty or invalid, the result is `null`.
- **Retry:** If the first planner call returns empty or unparseable output, the chat route retries once with an extra instruction: “Output only a single JSON object, no other text.”
- **Fallback:** When the plan is still `null` after retry, the route uses **intent-based fallback**: `inferFallbackPriorityOrder(message, recentContext, registry)` (keyword heuristics, e.g. “create agent” / “run workflow” → include `agent` and/or `workflow` in the route) so the system still routes to the right specialists instead of defaulting to `general` only.
- **Continuation (merge):** When the previous turn ended with `ask_user`, the plan for that turn is stored in memory (keyed by `conversationId`). On the next turn, if a **pending plan** exists, the planner is not started from zero: it is called with **buildPlannerContinuationPrompt(previousPlan, userReply, registry)**. The planner then outputs an **updated** plan (merge), so `refinedTask`, `extractedContext`, or `priorityOrder` can change with the user’s reply (e.g. different URL, “don’t run”). After the turn, if the reply again includes `ask_user`, the new plan is stored; otherwise the pending plan is cleared.

## Context

- **Planner context:**  
  - **Recent conversation:** Built by `buildRecentConversationContext(history, maxMessages, maxChars, options)` in the chat route. It includes the last N messages (default 4, cap 800 chars). Options can **append the current user message** and **preserve URLs** (larger cap when the text contains URLs or `savedSearchId`). This string is passed into `buildPlannerPrompt` as `recentConversationContext`. The planner also receives the current message separately as “User message”.
- **Specialist context:**  
  - Each specialist is invoked with **no conversation history** (`runAssistant([], specialistMessage, ...)`). The task string is either:
    - **With plan:** `enrichTaskWithPlan(refinedTask, specialistId, plan, previousSteps)` — adds plan instructions for that specialist, `extractedContext` as JSON, and previous steps’ summaries.
    - **Without plan (fallback):** The raw `refinedTask` plus “Previous steps” (if any) plus **recent conversation** (truncated) so the specialist still sees prior intent and URLs/IDs.
- **Pending plan:** When a heap turn finishes with `ask_user` (or equivalent “waiting for input”), the plan used for that turn is stored in `pendingPlanByConversation.set(conversationId, plan)`. On the next turn, that plan is passed as `pendingPlan` and the continuation prompt is used. When the turn completes without `ask_user`, the store entry is removed. The store is in-memory only (cleared on process restart).

## Message queue

- **Per-conversation serialization:** Only one turn runs per conversation at a time (conversation lock). The message queue (e.g. `runSerializedByConversation`) ensures that when a user sends a message, the turn runs with the latest history; the next message waits until the turn is done.
- **Trace steps:** The chat route emits trace steps for inspection: `planner_request`, `planner_response`, `heap_route`, `heap_expand`, `heap_specialist`, `heap_tool`, `heap_tool_done`, etc. These are written to the message queue log and can be viewed on the **Queues** page (select a conversation and expand steps). The planner’s raw output and parsed plan are in `planner_response`; the chosen route and refined task are in `heap_route`.

## Data flow (high level)

```mermaid
sequenceDiagram
  participant User
  participant Route
  participant PendingPlan
  participant Planner
  participant Fallback
  participant Heap
  participant Specialist

  User->>Route: message
  Route->>Route: Load history; insert user msg; build recent context
  alt Pending plan exists (continuation)
    Route->>PendingPlan: get(conversationId)
    Route->>Planner: buildPlannerContinuationPrompt(previousPlan, userReply)
    Planner->>Planner: LLM call
    Planner->>Heap: updated plan
  else New turn
    Route->>Planner: buildPlannerPrompt(msg, recentContext)
    Planner->>Planner: LLM call
    alt Valid plan
      Planner->>Heap: plan
    else Empty/invalid → retry then fallback
      Route->>Fallback: inferFallbackPriorityOrder
      Fallback->>Heap: fallback priorityOrder + refinedTask
    end
  end
  Heap->>Specialist: effectiveTask (enriched or with recent context)
  Specialist->>User: reply (tools, ask_user, etc.)
  alt Reply includes ask_user
    Route->>PendingPlan: set(conversationId, plan)
  else Done
    Route->>PendingPlan: delete(conversationId)
  end
  Route->>User: done (+ planSummary when heap)
```

## Related files

- **Chat route (heap entry):** `packages/ui/app/api/chat/route.ts` — `runHeapModeTurn`, pending plan store, `buildRecentConversationContext`, retry/fallback, planSummary in done payload.
- **Planner:** `packages/runtime/src/chat/heap/planner.ts` — `buildPlannerPrompt`, `buildPlannerContinuationPrompt`, `parsePlanOutput`, `inferFallbackPriorityOrder`, `enrichTaskWithPlan`.
- **Heap runner:** `packages/runtime/src/chat/heap/heap-runner.ts` — `runHeap`, DAG from `priorityOrder`.
- **Registry:** `packages/runtime/src/chat/heap/registry.ts` — default specialists and top-level ids.
- **Queues / diagnosis:** [queues-and-diagnosis.md](queues-and-diagnosis.md) — where to inspect queue and trace steps.
