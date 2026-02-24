# Plan: Fix Missing Workflow / Agent IDs and Test

## Problem summary

From message queue steps (conversation `6e7357c8-f776-47f2-991a-539ca5cc8769`):

1. **Planner** returned `priorityOrder: ["improvement", "workflow", "agent", "general"]`.
2. **Heap** runs specialists in that order (per level). So: improvement → workflow → agent → general.
3. **Workflow specialist** runs before the **agent specialist**. Its "Previous steps" only contain improvement’s outcome, so it never sees `[Created agent id: <uuid>]`.
4. Workflow specialist therefore cannot wire the workflow to the new agent (no agent id yet) and asks the user to confirm instead of creating the workflow and running it.

So the root cause is **ordering**: when the task is "create agent + create workflow + add agent to workflow (and run)", the workflow specialist must run **after** the agent specialist so it receives `[Created agent id: ...]` in Previous steps. Same idea applies to workflow id: if we "create workflow then run", the run step needs the workflow id from the create step (same turn via Previous steps, or next turn via persisted context).

## Fixes

### 1. Planner: agent before workflow when creating both (primary)

**Where:** `packages/runtime/src/chat/heap/planner.ts` — `buildPlannerPrompt`.

**Change:** Add an explicit rule so the planner puts `agent` before `workflow` when the user wants to create both an agent and a workflow and add the agent to the workflow (or run that workflow).

- Rule text (add to the "Rules" section):  
  `When the user wants to create both an agent and a workflow and add the agent to the workflow (or run it), put "agent" before "workflow" in priorityOrder so the workflow specialist receives [Created agent id: ...] in Previous steps. Example: ["improvement", "agent", "workflow", "general"] or ["agent", "workflow", "general"].`

**Why:** The heap runs specialists in order; only earlier steps appear in "Previous steps". So agent must run before workflow for the handoff to work.

### 2. Defensive reorder in chat route (optional but recommended)

**Where:** `packages/ui/app/api/chat/route.ts` — after `expandToLeaves` (or after computing `orderToRun`), before `runHeap`.

**Change:** If the plan implies "create agent and create workflow" (e.g. `extractedContext.requestedActions` includes both `create_agent_with_*` and `create_workflow` / `add_agent_to_workflow`, or instructions mention creating both), and the flattened `orderToRun` has `workflow` (or a workflow leaf like `workflow__part1`) before `agent`, reorder so that the agent step(s) come before the workflow step(s). Preserve relative order within agent and within workflow; only ensure every agent step is before every workflow step when both are present for this create-both scenario.

**Why:** Covers cases where the planner still returns workflow before agent.

**Implementation note:** Flatten `orderToRun` (expand `{ parallel: [...] }` to a list of ids), find indices of agent and workflow (including leaves like `workflow__part1`), and if any workflow index is less than any agent index, reorder so all agent ids come before all workflow ids, then rebuild the same structure (levels / parallel) as before if needed. Simplest: flatten to array, reorder array so agent ids precede workflow ids, then pass that to runHeap (runHeap/buildHeapDAG accept priorityOrder; we may need to emit a reordered sequence of steps that still matches the DAG shape — e.g. one level per step, so reordered flat list is valid).

### 3. Persist created workflow/agent ids into next turn’s plan (for "run it" follow-up)

**Where:** `packages/ui/app/api/chat/route.ts` — when storing the pending plan (e.g. when `hasWaitingForInputInToolResults` and we call `pendingPlanByConversation.set(conversationId, result.plan)`).

**Change:** If `result.toolResults` contains `create_workflow` or `create_agent` with an `id` in the result, merge those ids into the plan’s `extractedContext` (e.g. `workflowId`, `agentId`) before storing. So the next user message (e.g. "Run it now with defaults") gets a continuation plan that already has `extractedContext.workflowId` / `agentId` set when we had created them in the previous turn.

**Why:** So "run the workflow" / "run it" in the next message can use the created workflow id without asking the user.

**Edge case:** Only merge when we are actually storing the plan (ask_user path). If we created and ran in the same turn, no need to persist plan with ids.

### 4. Tests

**4.1 Planner prompt contains agent-before-workflow rule**

- **Where:** `packages/ui/__tests__/api/_lib/heap.test.ts` (or planner-specific test file if it exists).
- **What:** Build planner prompt with a message like "create an agent and a workflow and add the agent to it and run it". Assert the prompt string includes the rule (e.g. "agent\" before \"workflow\" or "put .* agent .* before .* workflow").

**4.2 Reorder: workflow-before-agent becomes agent-before-workflow**

- **Where:** `packages/ui/app/api/chat/route.ts` or a small helper in `packages/ui/app/api/_lib/chat-helpers.ts` + test in `chat-helpers.test.ts` or heap.test.
- **What:** Unit test for a function `reorderAgentBeforeWorkflowForCreateBoth(priorityOrder, plan)` (or inlined in route): given `["improvement", "workflow", "agent", "general"]` and a plan with create_agent + create_workflow intent, assert result has agent before workflow (e.g. `["improvement", "agent", "workflow", "general"]`). Test with expanded leaves (e.g. `workflow__part1`) as well.

**4.3 Integration: create agent + workflow flow still works**

- **Where:** `packages/ui/__tests__/api/chat.test.ts`.
- **What:** Existing test "create agent then workflow flow" already mocks planner to return `["agent", "workflow"]`. Keep it; optionally add a test that uses a planner mock returning `["workflow", "agent"]` and assert that either (a) reorder runs and we still get create_agent in tool results and workflow specialist receives agent id, or (b) at least one of planner rule or reorder is tested elsewhere so this test only checks happy path with correct order.

**4.4 Persisted plan gets created ids**

- **Where:** `packages/ui/__tests__/api/chat-helpers.test.ts` or chat route test.
- **What:** If we add a helper that merges created ids from tool results into a plan’s extractedContext, unit test it: input plan without workflowId/agentId, tool results with create_workflow and create_agent ids; assert output plan has extractedContext.workflowId and extractedContext.agentId. Integration test could simulate one turn with create_workflow + ask_user, then verify stored plan (or next turn’s plan) has workflowId.

## Implementation order

1. Add planner rule (1) and run existing heap/chat tests.
2. Add defensive reorder (2) and unit test for reorder (4.2).
3. Add planner prompt test (4.1).
4. Implement persist created ids (3) and unit test (4.4); then integration if needed.
5. Adjust or add integration test (4.3) as above.

## Files to touch

| Fix | File(s) |
|-----|--------|
| 1. Planner rule | `packages/runtime/src/chat/heap/planner.ts` |
| 2. Reorder | `packages/ui/app/api/chat/route.ts` (+ optional helper in `chat-helpers.ts`) |
| 3. Persist ids | `packages/ui/app/api/chat/route.ts` |
| 4.1 Planner test | `packages/ui/__tests__/api/_lib/heap.test.ts` or planner test |
| 4.2 Reorder test | `packages/ui/app/api/_lib/chat-helpers.test.ts` or heap.test.ts |
| 4.3 Integration | `packages/ui/__tests__/api/chat.test.ts` |
| 4.4 Persist test | `packages/ui/__tests__/api/_lib/chat-helpers.test.ts` |

## Success criteria

- For a prompt like "create an agent with self-improvement and create a new workflow and add the agent to it and run the workflow", the planner returns priorityOrder with agent before workflow (e.g. improvement, agent, workflow, general), or the route reorders so agent runs before workflow.
- Workflow specialist receives "Previous steps" that include the agent specialist’s outcome with `[Created agent id: <uuid>]`, so it can call create_workflow and update_workflow with that agent id.
- Optionally: after a turn that creates a workflow and ends with ask_user, the stored plan’s extractedContext includes workflowId (and agentId if created) for the next message.
