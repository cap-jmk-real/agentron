---
name: Merged heap context, ask balance, tool error, and search to leaves
overview: "Single plan: (1) Heap context and tool error fixes — scope studioContext so only agent sees full tools; add ask_user vs std-request-user-help guidance; give planner recent conversation context; balance asking vs doing. (2) Run until real tools — expand planner priorityOrder to leaf specialists (or have delegators return delegateHeap) so we run specialists with their own tool set, not the union of all parts."
todos:
  - id: scope-studio-context
    content: In runSpecialistInner, pass scoped studioContext; only agent gets full tools, others get tools []
    status: pending
  - id: ask-user-guidance
    content: Add explicit prompt guidance in choiceBlock — ask_user for chat only; std-request-user-help for workflow runs
    status: pending
  - id: planner-recent-context
    content: Add recentConversationContext to buildPlannerPrompt and inject from chat route history
    status: pending
  - id: ask-vs-do-balance
    content: Add planner rules and specialist prompt sentence for acting when intent clear, ask when ambiguous
    status: pending
  - id: search-from-node
    content: Add searchFromNode(registry, startNodeId, depthLimit, choose) in heap-search.ts
    status: pending
  - id: expand-to-leaves
    content: Add expandToLeaves(priorityOrder, registry, chooseFn, depthLimit) and integrate in chat route before runHeap
    status: pending
isProject: false
---

# Merged plan: Heap context, ask balance, tool error, and search to leaves

This document merges two plans: (A) heap context, ask balance, and workflow specialist tool error; (B) run planner/heap until real tools (recursive search).

---

## Part A — Heap context, ask balance, and tool error

### 0. Design principle: avoid full tool list

The heap and heap search were implemented so that **the full tool list is not sent to the LLM**. The goal is to surface only **relevant** tools for the task (via specialist toolNames and structured option groups) and let the planner and specialists make good decisions **without being overloaded** by every native tool ID. The **planner** already follows this. But **heap specialists** still receive the full "Studio resources" block with every tool by native id, which overloads the LLM and causes "Tool not available" when the model uses a native id. The primary fix is: **do not inject the full tool list for heap specialists** except for the agent specialist (who needs it for create_agent toolIds).

### 1. Problem summary (context, over-asking, tool error)

- **Context**: The planner and specialists only see the current user message, so they cannot infer intent from prior turns (e.g. "Run On Demand" after configuration).
- **Over-asking**: Instructions tell the planner and specialists to ask for workflowId, inputs, etc. even when intent is clear.
- **Error / full tool list**: Specialists get the full tools list; the workflow specialist called `std-request-user-help` (native tool ID from the "Studio resources" list in the prompt). The specialist's allowed list uses the logical name `ask_user`. The check `toolNames.includes(name)` fails. Root cause: exposing the full tool list to specialists who should only see heap-relevant tools.

### 2. Fix: No full tool list for heap specialists; LLM must use ask_user (not std-request-user-help) in chat

**Scope studio context so specialists do not see the full tool list**

- **[packages/ui/app/api/chat/route.ts](agentos-studio/packages/ui/app/api/chat/route.ts)**  
In `runSpecialistInner`, when calling `runAssistant`, pass a **scoped** `studioContext`:
  - **agent** specialist: pass full `opts.studioContext` (including tools) so it can create agents with correct `toolIds`.
  - **All other specialists** (workflow, general, improvement*, etc.): pass `{ ...opts.studioContext, tools: [] }` so the "Tools available (...)" block is not injected.

**Make the LLM understand the distinction (no aliases)**

- **ask_user** = "Ask in chat and continue in the next message." Use this when you (the chat/heap specialist) need to present a question or options to the user. This is the only correct tool for asking the user from within chat/heap specialists.
- **std-request-user-help** = "Pause a **workflow run**, ask the user, then resume the run with their reply." Used only by agents inside a running workflow. It is not available to chat specialists.

Add this distinction in the specialist system prompt for any specialist that has `ask_user` (e.g. in the `choiceBlock` in [packages/ui/app/api/chat/route.ts](agentos-studio/packages/ui/app/api/chat/route.ts) around lines 279–284): "In this chat context you must use ask_user only. Do not use std-request-user-help or 'Request user input (workflow pause)' — that tool is for workflow runs, not for chat."

### 3. Fix: Planner and heap get recent conversation context

- **[packages/runtime/src/chat/heap/planner.ts](agentos-studio/packages/runtime/src/chat/heap/planner.ts)**  
Extend `buildPlannerPrompt(userMessage, registry)` to accept optional `recentConversationContext?: string`. If provided, add a section before "User message:" and in Rules: use recent conversation to fill extractedContext and infer intent.
- **[packages/ui/app/api/chat/route.ts](agentos-studio/packages/ui/app/api/chat/route.ts)**  
Build a short recent-conversation string from `history` (e.g. last 2–4 messages), pass into `runHeapModeTurn` and into `buildPlannerPrompt`.

### 4. Fix: Balance asking vs doing

- **Planner** ([planner.ts](agentos-studio/packages/runtime/src/chat/heap/planner.ts)): Add rules — when intent is clear from recent conversation, set extractedContext/instructions so workflow can "list workflows; if only one, run it"; ask for workflowId/agentId only when genuinely ambiguous.
- **Specialist prompt** ([route.ts](agentos-studio/packages/ui/app/api/chat/route.ts)): Add one sentence in choiceBlock: "Prefer acting with sensible defaults when the user's intent is clear; use ask_user only when genuinely ambiguous."

### 5. Verification (Part A)

- Confirm non-agent heap specialists do not receive the "Tools available (...)" block; workflow specialist calls `ask_user` (not std-request-user-help) and call succeeds.
- In a multi-turn flow ("Run On Demand" after configuration), confirm planner or workflow infers running the workflow just discussed instead of only asking "which workflow?".

---

## Part B — Run planner / heap until real tools (recursive search)

### The problem

The planner returns **top-level specialist ids** (e.g. `general`, `workflow`, `improvement`). The registry splits specialists with many tools into **delegators** (no `toolNames`) and **leaf parts** (e.g. `workflow__part1`, `workflow__part2`). In chat we still **run the delegator id** and give it the **union of all parts' tools** via `getToolsForSpecialist(registry, id)`. So we never "run until we find the real tools" — we run one logical specialist with the full tool set, which defeats the per-specialist tool cap and overloads the model.

We want either: **(A)** run the planner/search until we get **leaf** specialists, then run only those; or **(B)** when we run a **delegator**, it only chooses which child to run and returns `delegateHeap`; the runner then runs the child (recursively until a leaf).

### How heap search works today

- **Tree**: Root = `nodeId === null`. Children = `getChildSpecialistIds(registry, nodeId)`. Leaves = entries with `toolNames.length > 0`.
- **Options at node**: [getOptionsAtNode(registry, nodeId, optionsCap)](agentos-studio/packages/runtime/src/chat/heap/registry.ts) — at root returns primary top-level ids; else children; capped.
- **Path search**: [searchHeapPath(registry, depthLimit, choose)](agentos-studio/packages/runtime/src/chat/heap/heap-search.ts) — at each level get options, chooser returns one id or null; path can end at a delegator (does not stop at leaf).
- **Runner**: [runHeap](agentos-studio/packages/runtime/src/chat/heap/heap-runner.ts) builds DAG from priorityOrder; if a specialist returns `delegateHeap`, runHeapFromDAG runs sub-DAG. In chat, `runSpecialistInner` only returns `{ summary }`, never `delegateHeap`.

### Approach 1: Expand priorityOrder to leaves (recommended)

After the planner returns `priorityOrder`, **expand** each id to a **leaf** before building the DAG:

- For each step `id` in `priorityOrder`: while `id` is a **delegator** (entry has `delegateTargets` and `toolNames.length === 0`), get options with `getOptionsAtNode(registry, id)` and call an **LLM chooser** with task + options to pick one child; set `id = chosen`. Repeat until leaf or depth limit.
- Build DAG from the **expanded** list (only leaf ids), then run as today.

Concretely:

- Add **searchFromNode(registry, startNodeId, depthLimit, choose, optionsCap?)** in [heap-search.ts](agentos-studio/packages/runtime/src/chat/heap/heap-search.ts): start from `getOptionsAtNode(registry, startNodeId)`, then continue like searchHeapPath; optionally stop when chosen node has `toolNames.length > 0`.
- Add **expandToLeaves(priorityOrder, registry, chooseFn, depthLimit)** (e.g. in planner or heap-search): for each id in flattened steps, if delegator, call searchFromNode and replace with path's last id (or first leaf); preserve `{ parallel: [...] }`. Integrate in chat route after parsing the plan and before `runHeap`.

### Approach 2: Delegators only delegate (no tools)

When the runner is about to run a **delegator**: run a delegation-only step (prompt + child options), LLM returns which child(ren); parse into `delegateHeap`, return `{ summary, delegateHeap }`. runHeapFromDAG already runs sub-DAG. Chat's runSpecialistInner must detect delegator (`entry.toolNames.length === 0 && entry.delegateTargets?.length`), run "choose subspecialist" prompt, parse and return `delegateHeap`. Downside: one extra LLM round per delegator level.

### Recommendation (Part B)

Implement **Approach 1** so the plan (or post-plan expansion) already targets **leaf** specialists; runner and chat stay simple and we never send the full union of tools to a single model.

---

## Summary table (Part B)


| Concept               | Where                                                                  | Notes                                                         |
| --------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| Options at node       | getOptionsAtNode(registry, nodeId)                                     | Root = top-level; else children; capped.                      |
| Path from root        | searchHeapPath(registry, depthLimit, choose)                           | Chooser picks one per level; path can end at delegator.       |
| Path from node        | (to add) searchFromNode(registry, startNodeId, depthLimit, choose)     | Same from startNodeId; optional stop at first leaf.           |
| Expand to leaves      | (to add) expandToLeaves(priorityOrder, registry, chooseFn, depthLimit) | Replace each delegator with a leaf by repeated choose.        |
| Delegation at runtime | runHeapFromDAG + delegateHeap                                          | Already recursive; chat currently never returns delegateHeap. |


---

## Files to touch (merged)


| Area             | File                                          | Change                                                                                                     |
| ---------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Full tool list   | packages/ui/app/api/chat/route.ts             | In runSpecialistInner, scoped studioContext: only agent gets full tools; others tools: [].                 |
| ask_user vs run  | packages/ui/app/api/chat/route.ts             | In choiceBlock for ask_user, add guidance: ask_user in chat only; std-request-user-help for workflow runs. |
| Context          | packages/runtime/src/chat/heap/planner.ts     | Add recentConversationContext? to buildPlannerPrompt, inject into prompt and rules.                        |
| Context          | packages/ui/app/api/chat/route.ts             | Build recent-conversation from history, pass to runHeapModeTurn and buildPlannerPrompt.                    |
| Ask balance      | packages/runtime/src/chat/heap/planner.ts     | Add planner rules for clear intent and when to ask vs run.                                                 |
| Ask balance      | packages/ui/app/api/chat/route.ts             | Add one sentence to specialist prompt: prefer action when intent clear.                                    |
| Search from node | packages/runtime/src/chat/heap/heap-search.ts | Add searchFromNode(registry, startNodeId, depthLimit, choose, optionsCap?).                                |
| Expand to leaves | packages/runtime (planner or heap-search)     | Add expandToLeaves(priorityOrder, registry, chooseFn, depthLimit).                                         |
| Expand in chat   | packages/ui/app/api/chat/route.ts             | After parsing plan, call expandToLeaves before runHeap (when implementing Part B).                         |


