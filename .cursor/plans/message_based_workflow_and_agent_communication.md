# Message-based agent & workflow communication — event-driven architecture

This document **extends** the [MASTER_PLAN_heap_self_improvement_logs_ux_tokens.md](MASTER_PLAN_heap_self_improvement_logs_ux_tokens.md) and [workflow_memory_and_context_delivery.md](workflow_memory_and_context_delivery.md) by introducing **message-based** and **event-driven** patterns where they add clarity, observability, and future flexibility. It does **not** replace the master plan; it refines *how* communication and workflow execution are implemented.

---

## 1. Goals

1. **Agent and workflow communication message-based** — Within a workflow run, agents (and other nodes) communicate via **messages** (e.g. step output, partner message) rather than only via shared mutable keys. This enables a single source of truth for “what happened” and supports replay, debugging, and bounded context (e.g. “last N messages” for heap/improvement).
2. **Observability event-driven** — Run logs, execution trail, and progress are produced by **events** (e.g. `step_completed`, `log`, `tool_called`). One producer, multiple consumers: DB writer, live UI, `get_run_for_improvement`, and optional SSE/streaming.
3. **Clear boundaries** — Identify where to **replace** direct coupling with events vs where to **keep** synchronous calls (e.g. LLM + tool loop inside one node).

---

## 2. Current architecture (summary)

| Area | Current | Coupling |
|------|---------|----------|
| **Workflow node-to-node** | `SharedContextManager`: `get/set(__output_<nodeId>)`, `__round`, `__recent_turns`, `__summary`. Engine runs handlers in sequence or by edges; each handler reads previous output from context, runs, writes back. | Tight: same process, mutable shared state. |
| **Run logs** | `run-workflow` and tools call `db.insert(runLogs)` directly and push `trail` via `onStepComplete` / `onProgress` callbacks. | Tight: callers know about DB and callback shape. |
| **Trail** | Built in-memory in `run-workflow` (array), passed to `onStepComplete`; execute route writes to `executions.output` (JSON with trail). | Tight: trail is side effect of execution, not a first-class stream. |
| **Heap (planned)** | Router returns `priorityOrder`; heap runner runs specialists sequentially/parallel, “context between steps = structured summary.” | Not yet implemented; plan says summary only. |
| **Improvement / Retry** | User clicks Retry → execute route or chat runs improvement workflow then `runWorkflow` again. | Procedural: no explicit event. |

---

## 3. Where event-driven / message-based helps

### 3.1 Run observability (logs + trail)

**Replace:** Direct `db.insert(runLogs)` and in-memory `trail` array + `onStepComplete(trail)`.

**With:** A **run-scoped event bus** (or event emitter) for the duration of one execution:

- **Events (producers):**
  - `log` — level, message, payload, source tag (e.g. `[Agent]`, `[Tool]`, `[Playwright]`). Emitted by run-workflow, tool adapters, container stream, etc.
  - `step_started` — nodeId, agentId, round.
  - `step_completed` — nodeId, agentId, order, round, input, output, error?, toolCalls?.
  - `step_failed` — nodeId, error, partial trail.
  - `request_user_help` — question, options; run pauses.
  - `progress` — message, toolId?.
  - `cancelled` — run cancelled.

- **Consumers (subscribers):**
  - **DB writer** — On `log` → `insert(runLogs)`; on `step_completed` / `request_user_help` → update `executions.output` with trail (or append to trail in output). Same schema as today; just fed by events.
  - **Live UI** — Same events can be forwarded over SSE or polling: “trail updated”, “new log line”. UI already polls run; could optionally subscribe to an event stream for this run.
  - **get_run_for_improvement** — Reads from DB (run_logs + output.trail). No change to API; the fact that logs/trail are event-sourced means we could later add “replay” or “trail from event log” if needed.

**Benefits:** Single place that defines “what happened”; multiple consumers without each producer knowing about DB or UI; easier to add new consumers (e.g. analytics, audit). **Token/minimal context** unchanged: `get_run_for_improvement` still returns bounded summary + recent errors from stored run_logs and trail.

### 3.2 Workflow node-to-node: messages as first-class

**Current:** Nodes read/write `sharedContext` (`__output_<id>`, `__recent_turns`, `__summary`). The engine could stay as-is for **control flow** (who runs next), but **data** between nodes can be modeled as **messages**.

**Option A (minimal change):** Keep `SharedContextManager` for backward compatibility. **Add** a parallel **message list** per run: each time a node finishes, we append a message `{ from: nodeId, role: 'agent'|'node', content: output, round }`. The **agent handler** builds “partner message” and “workflow memory” from this list (e.g. “last message from previous node”, “last N messages for summary”). So we have both: sharedContext for existing keys (e.g. `__round`), and a **message stream** as the source of truth for “what each node said.” Trail and `get_run_for_improvement` already represent this; we just make the in-run representation message-based.

**Option B (fuller message-based):** Nodes no longer write to `sharedContext` for partner output. Instead they **emit** a `step_completed` event (or `node_output` message). The **runner** maintains an **inbox** or **last message per node** from these events. The next node’s input is built from “last message from source node” (and optional “last N messages” for multi-turn summary). SharedContext only holds control/metadata (`__round`, optionally `__recent_turns` / `__summary` derived from messages). This aligns with event-driven trail: the same events that update the trail also drive “what the next node sees.”

**Recommendation:** Start with **Option A** (message list alongside sharedContext) so run observability is event-driven and “partner message” is derived from messages; then, if desired, migrate to Option B (sharedContext only for control, messages for all content).

### 3.3 Heap (multi-agent) — already message-like

The master plan already says:
- “Context between steps = **structured summary only**”
- “Structured summary (e.g. step id, outcome, 1–2 lines); no full JSON dumps”

So each specialist run produces a **result** that is then **summarized** and passed as context to the next. That result can be modeled as a **message**: `{ specialistId, outcome, summary }`. The heap runner:
- Runs specialist → gets result → **emits** `heap_step_completed` (or stores as message).
- Builds **summary** from last N such messages (cap tokens).
- Passes summary to next specialist as context.

No need for a separate “heap event bus” in phase 1; the important part is **message-shaped data** (step result + summary) and **bounded context**. If we later want live UI for heap runs, we can reuse the same run-scoped event bus and add event types for heap steps.

### 3.4 User actions: Done / Retry as events

**Current:** Retry is “user clicks Retry → backend runs improvement workflow → runs workflow again.” No explicit event.

**Improvement:** Treat user actions as **events** in the API or app layer:
- **Done** — `user_goal_achieved(runId)` → mark run complete, stop any retry loop.
- **Retry** — `user_request_retry(runId, note?)` → enqueue or start improvement workflow with runId + note; on improvement completion, emit `run_workflow(workflowId, runId?)` or start new run.

This doesn’t require a message broker; it can be “event” in the sense of a clear API or function call that triggers a defined flow. Benefits: same pattern for Chat and Run page; easy to add “on run failed → auto-retry” (emit retry event under conditions); and consistent with “minimal interactions” (one action = one event).

### 3.5 What to keep synchronous

- **LLM + tool loop inside one agent node** — Request/response; no need to make this event-driven.
- **Workflow engine control flow** — Which node runs next can remain deterministic (edges + rounds). Events are for **data** (outputs, logs) and **observability**, not necessarily for scheduling (unless we later add “event-driven workflow” where nodes are triggered by messages).
- **Improvement workflow execution** — Still a workflow run; only the **trigger** (Retry event) is event-like.

---

## 4. Proposed architecture (summary)

| Layer | Mechanism | Purpose |
|------|-----------|--------|
| **Run-scoped event bus** | One emitter/bus per run. Events: `log`, `step_started`, `step_completed`, `step_failed`, `request_user_help`, `progress`, `cancelled`. | Observability: DB writer, trail builder, live UI, get_run_for_improvement (reads from DB). |
| **Message list (per run)** | Append-only list of “node output” messages (from, role, content, round). | Source of truth for “what each node said”; build partner message and workflow memory from this. |
| **SharedContext (optional)** | Keep for `__round`, `__recent_turns`, `__summary` or derive from message list. | Backward compatibility and control data; can be reduced over time. |
| **User actions** | Done / Retry as explicit events (API or in-app). | Clear trigger for completion and improve+retry flow. |
| **Heap** | Step result = message-shaped (specialistId, outcome, summary); context = last N summaries. | Aligns with master plan; no separate bus needed initially. |

---

## 5. Implementation order (integrated with master plan)

Implement in an order that keeps the system working and avoids big-bang rewrites.

1. **Run-scoped event bus (observability)**  
   - Add a small `RunEventBus` or use an EventEmitter per run in `run-workflow`.
   - Emit `log`, `step_started`, `step_completed`, `progress`, `request_user_help`, `cancelled` from current code paths (replace direct `db.insert(runLogs)` and `onStepComplete` with `bus.emit(...)`).
   - **Single subscriber:** “RunObserver” that writes to DB (run_logs, execution output with trail) and calls `onStepComplete` / `onProgress` with the same data. So behavior is unchanged; producers are decoupled from DB.
   - **Files:** `packages/ui/app/api/_lib/run-workflow.ts`, optional `packages/runtime` or `_lib/run-events.ts`.

2. **Message list for node outputs**  
   - In run-workflow, maintain `runMessages: Array<{ from: string; role: string; content: unknown; round?: number }>`.
   - On each agent/node step completion, push to `runMessages` and emit `step_completed`.
   - Build “partner message” and “workflow memory” from `runMessages` (e.g. last from previous node, last N for summary) instead of only `sharedContext.get(__output_<id>)`. Keep writing `__output_<nodeId>` to sharedContext for now so the engine and any code that still reads it keep working.
   - **Files:** run-workflow agent handler, workflow memory block builder.

3. **Run logs and trail from events only**  
   - Remove direct `db.insert(runLogs)` from run-workflow and tools; all log lines go through `bus.emit('log', ...)`. RunObserver subscribes and inserts.
   - Trail built only from `step_completed` events (or from runMessages). So trail and run_logs are fully event-sourced for the run.
   - **Files:** run-workflow, tool adapters (they receive a `log` callback or runId + bus from context).

4. **User actions as events**  
   - Run page and Chat: “Retry” calls an API that explicitly means “user_request_retry(runId, note?)”; backend runs improvement then new run. “Done” = “user_goal_achieved(runId)”. Document as the contract; optional: internal event names for consistency.
   - **Files:** execute route, chat route, runs API.

5. **Heap runner (when implemented)**  
   - Specialist result = message-shaped; heap runner keeps “last N step summaries” and passes to next. If we add run-scoped events for heap, emit `heap_step_completed` so the same RunObserver can persist heap trail if needed.
   - **Files:** heap runner (new), chat route (heap mode).

6. **Optional: second consumer for live UI**  
   - RunObserver already updates DB; UI polls. Optionally, allow a second subscriber that streams events (e.g. SSE) for the run so the UI can show “new step” or “new log line” without polling. Not required for message-based correctness.

---

## 6. Checklist (message-based / event-driven)

- [ ] **Run-scoped event bus** — Emit `log`, `step_started`, `step_completed`, `progress`, `request_user_help`, `cancelled`; single RunObserver writes to DB and calls onStepComplete/onProgress.
- [ ] **No direct run_logs insert from run-workflow/tools** — All logs via bus.emit('log').
- [ ] **Message list per run** — Append node output messages; build partner message and workflow memory from this list; keep sharedContext for compatibility.
- [ ] **Trail from events** — Trail built only from step_completed (or runMessages); single source of truth.
- [ ] **User actions** — Done / Retry as explicit API/contract; optional internal event names.
- [ ] **Heap (when built)** — Step result message-shaped; context = last N summaries; optional heap_step_completed events.
- [ ] **Docs/ADR** — Short ADR: “Run observability is event-driven; node-to-node data is message-based.”

---

## 7. Out of scope (for this plan)

- **Distributed message broker** (e.g. Redis, RabbitMQ) — Not required for single-process workflow runs. If we later split runners to workers, we can introduce a queue then; the event types above can be the same.
- **Full event-sourced workflow engine** — Nodes still run in process, in order; we only make **data** and **observability** message/event-based.
- **Changing get_run_for_improvement API** — It still reads from DB (run_logs + output.trail); how that data got there (events) is an implementation detail.

---

This plan makes **agent and workflow communication message-based** within a run (message list + events) and **workflow/run observability event-driven** (one bus, multiple consumers), while keeping the rest of the master plan (heap, self-improvement, run logs UX, tokens) unchanged and aligning implementation with a clear, extensible architecture.
