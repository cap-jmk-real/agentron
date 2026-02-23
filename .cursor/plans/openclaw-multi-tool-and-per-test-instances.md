# OpenClaw: multi-tool infra and per-test instances

## 1. What the OpenClaw e2e actually uses (chat heap, not created agents)

**The OpenClaw e2e does *not* trigger the full infra (workflows, runs, created agents).** It uses the **main chat API with heap mode**, and the **heap specialist** calls OpenClaw tools directly:

- Requests are sent to `POST /api/chat?stream=1` with **`useHeapMode: true`** ([openclaw.e2e.ts](packages/ui/__tests__/e2e/openclaw.e2e.ts) lines 685, 1100, 1172).
- The heap (router → planner) routes to the **"agent" specialist**, which has `send_to_openclaw`, `openclaw_history`, `openclaw_abort` in its tool list ([registry.ts](packages/runtime/src/chat/heap/registry.ts) ~346–347).
- That **specialist** runs `runAssistant` and **calls those tools itself**. There is no `create_agent`, no `create_workflow`, and no `execute_workflow`.

So the flow today is: **chat → heap → specialist (runAssistant) → send_to_openclaw / openclaw_history**. Workflows and runs are not in the loop; the "agent" that talks to OpenClaw is the heap specialist, not a studio-created agent running in a workflow.

---

## 2. Multi-tool policy: chat vs node agents

**Policy:** Keep multiple tools per round **possible for chat**; use **round-based (one tool per round) for node agents**.

### Chat assistant (heap) — keep multi-tool per round

- **No change.** The chat path continues to allow multiple tools in one turn:
  - **Runtime** ([packages/runtime/src/chat/assistant.ts](packages/runtime/src/chat/assistant.ts)): `extractAndRunToolCalls` parses **all** `<tool_call>...</tool_call>` blocks from the model response and runs them in sequence. One LLM reply can contain e.g. `web_search` and `send_to_openclaw`; both are executed in that turn. Follow-up rounds (default 2) allow more tool calls after seeing results.
  - **Heap** ([packages/ui/app/api/chat/_lib/chat-route-heap.ts](packages/ui/app/api/chat/_lib/chat-route-heap.ts)): Specialists use the same runtime; `result.toolResults` is an array and is aggregated.
- For the **current** OpenClaw e2e (heap), the Interleaved failure is the **model** not emitting both tools in the same turn, not missing infra.

### Node agents (workflow agent nodes) — round-based, one tool per round

When testing OpenClaw via a **created** agent (workflow run), that path uses the node-agent:

- **Execution:** `execute_workflow` runs the workflow engine, which runs agent nodes via [packages/runtime/src/agent/node-agent.ts](packages/runtime/src/agent/node-agent.ts) `runLLMWithDecisionLayer`. **One tool per round:** if the model returns multiple `tool_calls`, execute only the first, append result, then run the agent again (multiple rounds).
- **Tool execution**: The node-agent uses the **provider’s** `tool_calls` array (structured API), not `<tool_call>` blocks. When `res.toolCalls?.length > 1`, take only the first tool call, run it, push one tool result, and continue the loop so the next LLM call can issue the next tool. Continue until no tool calls or round cap.
- **Rationale:** Simpler mental model; multiple tools = multiple rounds of the same agent. For multiple behaviours in one workflow run, use multiple agents in one workflow (see below).

**Summary:** Chat = multi-tool per round allowed (unchanged). Node agents = round-based, one tool per round. Multiple behaviours in one workflow run = multiple agents in one workflow.

### Multiple behaviours in one workflow run — multiple agents in one workflow

For **multiple behaviours in one (workflow) round**, use **multiple agents in one workflow** instead of one agent doing multiple tool calls:

- One workflow run (`execute_workflow`) can run **several agent nodes** in sequence (or parallel, if the graph allows). Each agent still does **one tool per round** within its own loop, but the workflow composes them: e.g. **Agent A** (tools: `web_search`) runs first and produces output; **Agent B** (tools: `send_to_openclaw`, `openclaw_history`) takes A's output as input and talks to OpenClaw. One workflow execution = one "round" at the workflow level, with multiple behaviours implemented by multiple agents.
- Use this when designing "research then OpenClaw" or similar: create two agents, wire them in one workflow (A → B), run once. No need for one agent to do both in multiple rounds; the workflow structure expresses the pipeline.

---

## 3. New OpenClaw instance per test

**Problem:** `ensureOpenClawGateway()` **reuses** the first sandbox in `sandboxIdsForTeardown` when one already exists ([openclaw.e2e.ts](packages/ui/__tests__/e2e/openclaw.e2e.ts) lines 244–263). All tests that call it share one OpenClaw container and one session history, so:

- **Abort then send** and **Structured reply** assert on “last assistant message,” which can be from an earlier test/turn (e.g. “Say hello from host Ollama…”), not the reply to the current user message.

**Change:** Create a **new** OpenClaw sandbox for each test that needs one.

**Implementation:**

- In [packages/ui/__tests__/e2e/openclaw.e2e.ts](packages/ui/__tests__/e2e/openclaw.e2e.ts), **remove the reuse block** in `ensureOpenClawGateway()` (the `if (sandboxIdsForTeardown.length > 0) { ... return { ok: true, sandboxId: reuseId, ... }; }` block). When `openclawHealth()` is false, always create a new sandbox (existing creation logic), push its id to `sandboxIdsForTeardown`, and return that new `sandboxId`. Existing `afterAll` already tears down every id in `sandboxIdsForTeardown`.
- **Result:** Every test that calls `ensureOpenClawGateway()` gets its own container and fresh session. Abort and structured-reply tests will see only their own user/assistant messages.

**Trade-off:** More containers and startup time per run. If needed later, we can add an opt-in “reuse” mode (e.g. env flag) for faster runs.

---

## 4. Optional: “reply to last user message” helper

With per-test instances, “last assistant” in that test’s session is the reply to the last user message, so the abort and structured-reply failures should be resolved by (3) alone. If we still see edge cases (e.g. multi-turn within one test), we can add a helper that, given normalized history, returns the assistant reply following the most recent user message.

---

## 5. Follow-up: Test full infra (created agent runs OpenClaw via chat)

**Goal:** Exercise the full stack — chat → heap → create agent + workflow → execute_workflow → **run** (created agent / node-agent) calls send_to_openclaw and openclaw_history.

**Desired flow:**

1. User sends a chat message that asks for an agent that uses OpenClaw (e.g. "Create an agent that can talk to OpenClaw in sandbox X and ask it to say hello; then run it.").
2. Heap planner routes to specialists that:
   - **create_agent** with toolIds including `send_to_openclaw`, `openclaw_history` (and any LLM/config), and a system prompt that instructs the agent to use OpenClaw for the given task.
   - **create_workflow** and **update_workflow** to wire that agent into a single-node workflow.
   - **execute_workflow** to start a run.
3. The **workflow run** executes the agent node; the **node-agent** ([node-agent.ts](packages/runtime/src/agent/node-agent.ts)) receives input and calls `send_to_openclaw` / `openclaw_history` (and optionally `web_search` if we add it to the agent's tools).
4. E2E asserts: run completes, run output or trail shows OpenClaw usage, and/or openclaw_history (or run result) contains the expected reply.

**Implementation notes:**

- Ensure `send_to_openclaw` and `openclaw_history` (and `openclaw_abort` if needed) are available in the studio tool list (e.g. `list_tools`) so `create_agent` can reference them by id in `toolIds`.
- Prompt design: the chat message must be phrased so the planner produces a plan that includes create_agent, create_workflow, update_workflow, execute_workflow — and the agent's system prompt or input must include the sandboxId and the OpenClaw task (say hello, get history, etc.). The specialist(s) then execute that plan.
- One or more dedicated e2e scenarios (e.g. "OpenClaw via created agent: chat creates agent and workflow, run uses OpenClaw") with a fresh sandbox from `ensureOpenClawGateway()` or `createOneOpenClawSandbox()`, and assertions on the execute_workflow result (run output/trail or subsequent openclaw_history call).
- **Node-agent:** one tool per round (see section 2). For "research then OpenClaw", either one agent in multiple rounds or **multiple agents in one workflow** (e.g. Agent A = web_search, Agent B = send_to_openclaw; wire A → B and run once).

**Scope:** Add this as a follow-up section to the plan; implementation can be a separate task/PR after per-test instances (section 3) are in place.

---

## Summary

| Item | Action |
|------|--------|
| What e2e uses today | OpenClaw e2e uses **chat + heap**; the **specialist** calls OpenClaw tools directly. **No** workflows, **no** runs, **no** created-agent execution. |
| Multi-tool (heap) | No change. Infra supports it; Interleaved failure is model behavior. |
| Multi-tool (node agents) | Round-based: one tool per round. Multiple behaviours in one workflow run = multiple agents in one workflow. |
| Per-test OpenClaw instances | Remove sandbox reuse in `ensureOpenClawGateway()` so each test gets a new sandbox when using container. |
| Abort / structured-reply wrong message | Addressed by per-test instances; optional helper only if needed later. |
| Full infra (optional follow-up) | Add scenario(s) where chat causes heap to **create_agent** (with OpenClaw tools) + **create_workflow** + **update_workflow** + **execute_workflow**; assert the **run** (node-agent) performs OpenClaw actions. |
