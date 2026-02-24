# Plan: Simple questions — planner decides, plan drives implementation

## Intent

- **Always trigger the planner.** No fast path that skips the planner.
- **Planner decides** whether the user message is a simple question (definitional/factual, no create/edit/run intent).
- **Planner updates the plan**: if simple question → set `priorityOrder` to `["general"]`, set `refinedTask` and `instructionsForGeneral` so the general specialist will answer directly.
- **Implementation** = existing heap: run specialists per `priorityOrder`; general runs with its tools (including `answer_question`) and the plan’s instructions, so it calls `answer_question` and the LLM responds with the answer.

## Current gap

1. **General specialist lacks answer tools** — In [packages/runtime/src/chat/heap/registry.ts](packages/runtime/src/chat/heap/registry.ts), the general specialist’s `toolNames` do not include `answer_question`, `explain_software`, or `web_search`, so even when the planner routes to general only, the specialist cannot answer.
2. **Planner prompt doesn’t define “simple question” or how to plan for it** — The planner is not instructed to detect a simple question and output a plan that results in a direct answer (general only + clear instructions).

## Implementation

### 1. Give the general specialist the right tools

**File:** [packages/runtime/src/chat/heap/registry.ts](packages/runtime/src/chat/heap/registry.ts)

- Add to the `general` spec’s `toolNames`: `answer_question`, `explain_software`, `web_search`.
- Keep total ≤ 10 tools (current 7 + 3 = 10).
- Optionally update the general specialist’s `description` to mention answering general/definitional questions, explaining software, and web search.

### 2. Planner: decide “simple question” and output the right plan

**File:** [packages/runtime/src/chat/heap/planner.ts](packages/runtime/src/chat/heap/planner.ts) — `buildPlannerPrompt`

- Add explicit rules for **simple questions**:
  - **Definition:** A “simple question” is a user message that is purely factual, definitional, or conversational (e.g. “What is X?”, “Explain Y”, “What are canary thresholds?”) and does **not** ask to create, edit, list, or run agents, workflows, or tools.
  - **When the planner decides it is a simple question:**
    - Set `priorityOrder` to **`["general"]` only** (no agent, workflow, improve_*).
    - Set `refinedTask` to a short task reflecting the question (e.g. “Answer the user’s question: …” or the user message itself).
    - Set `instructionsForGeneral` to something like: “Call answer_question with the user’s question. Then respond with a clear, concise answer. Do not create or modify agents or workflows. Do not call list_agents, create_workflow, or other resource tools.”
  - **When the planner decides it is not a simple question:** Use existing rules (agent, workflow, improve_*, etc.) and do not restrict to general only.

- No code path should skip the planner; the planner always runs and its output (including “simple question” vs not) is what drives the heap.

### 3. No planner bypass

- Do **not** add a fast path that skips the planner for “obvious” simple questions. The planner is the single place that decides and updates the plan; the heap then implements whatever plan the planner produced.

### 4. Heap implementation (existing behavior)

- No change to heap execution: when the plan has `priorityOrder: ["general"]`, the heap runs only the general specialist with `refinedTask` and `instructionsForGeneral` from the plan.
- General specialist (after step 1) has `answer_question`; with the instructions above it will call `answer_question` and then the LLM will produce the answer in the same turn. Existing `getAssistantDisplayContent` and turn completion logic already handle `answer_question` tool results.

### 5. Unit tests (meet project criteria)

- **Registry:** Assert `getToolsForSpecialist(registry, "general")` includes `"answer_question"`, `"explain_software"`, `"web_search"`, and total ≤ 10.
- **Fallback:** For a message like “What are canary thresholds?” (no create/run agent/workflow), assert `inferFallbackPriorityOrder` returns an order that includes general (e.g. `["general"]` when general is first in the registry).
- **answer_question handler:** Already covered in execute-tool.test.ts; add only if new branches are introduced.
- **getAssistantDisplayContent:** Add a test for the branch where `answer_question` was used and content is long (content used as display).

All unit tests: no LLM, mocks for planner/heap where needed; test inputs/outputs and observable behavior per testing-strategy and coverage rules.

### 6. E2e test

- One e2e test: create conversation, POST a simple question (e.g. “What is 2+2?”), wait for turn completion.
- Assert: at least one tool call is `answer_question`; final assistant message is non-empty and looks like an answer (e.g. contains “4” for 2+2).
- Use real LLM when configured; skip with clear message when not (same pattern as other e2e).

## Order of work

1. Registry: add `answer_question`, `explain_software`, `web_search` to general specialist.
2. Planner: add “simple question” definition and rules (priorityOrder `["general"]`, instructionsForGeneral) in `buildPlannerPrompt`.
3. Unit tests: registry, fallback, getAssistantDisplayContent.
4. E2e: chat simple-question test.
5. Run test:coverage and e2e; fix any gaps.

## Summary

- **Planner** = always runs; decides “simple question” vs not; updates plan (priorityOrder, refinedTask, instructionsForGeneral).
- **Implementation** = heap runs with that plan; general runs and uses `answer_question` when the plan says so.
