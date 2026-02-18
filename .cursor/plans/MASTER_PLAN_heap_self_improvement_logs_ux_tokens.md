# Master plan: Heap, self-improvement, run logs, UX, token usage

Single plan that lists **everything**: multi-agent heap, self-improvement until goal achieved, improved run logs, minimal-interaction UX, and minimal token usage. One implementation order, one test strategy, one checklist.

---

## 1. Overview and principles

### 1.1 Vision

- **Heap (Agentron multi-agent):** The chat assistant can run in **heap mode**: a **router** (sees only top-level specialist ids, ≤10) outputs a **heap** (ordered steps: specialist id or parallel group). A **heap runner** runs steps, merges context, supports **delegators** (sub-heaps, depth limit). Each specialist has ≤10 tools; no LLM sees all tools. The **registry** (specialist list) can be loaded from DB/store. **In the current phase the improver does not touch the heap or specialist registry** — the improver only updates workflow agents and workflows. The design should allow improver→heap integration (e.g. improver-created agents as specialists) **in the future**.
- **Run until goal achieved:** A **task run** (workflow or heap) runs. We **ask the user** "Is the goal achieved?" (with optional goal-checker hint). If not, we **improve** (from run logs + optional user note) and **retry**. Improvement changes prompts, code, tools, and **workflow agents/workflows** (and optionally record_technique_insight). It does **not** modify the heap or specialist registry in the current phase; that remains possible later. Loop until the user says Done.
- **Run logs:** Every run has rich **run_logs** (source tags: [Playwright], [Run code], [Container], [Code agent], [Agent], [Tool], etc.) and **trail** in output. **get_run_for_improvement(runId)** returns bounded run context (summary + recent errors by default) for the improver.
- **UX:** User has **minimal interactions**: two actions (Done / Retry), optional note under Retry, one toggle for self-improvement, one-line "what went wrong" when failed/waiting. No jargon; settings and advanced options hidden until needed.
- **Tokens:** Every LLM gets **minimum context**: router = ids only; heap context = structured summary; get_run_for_improvement = summary + recent errors (cap/truncate); get_feedback_for_scope = short rows; improvement = one call when possible.

### 1.2 Core principles

1. **Minimal interactions** — User only interacts when necessary. Default to the path that needs no input; ask only when we need human judgment. Two main actions: Done / Retry. Feedback = optional, collapsed.
2. **Minimal token usage** — Only send each LLM the minimum context it needs. Cap and summarize run logs, feedback, and history. One-call improvement when possible.
3. **One place per task** — Controls live where the user expects them (e.g. self-improvement on the agent node).
4. **Progressive disclosure** — Sensible defaults; advanced options behind "More options" or in the workflow editor.
5. **State visible when relevant** — e.g. "Multi-agent" badge so the user is not confused.
6. **Heap untouched by improver (for now)** — In the current phase the self-improving agent does **not** modify the Agentron multi-agent (heap) architecture or the specialist registry. The improver only updates workflow agents and workflows. The design should allow improver→heap integration (e.g. improver-created agents as specialists, or improvement as a heap specialist) in the future.

---

## 2. Run logs (improved)

### 2.1 What we have

| Item | Description |
|------|-------------|
| **run_logs table** | level, message, optional payload (JSON string). Inserted during workflow run. |
| **Source tags** | Every message has a prefix so we know the source: [Playwright], [Run code], [Container], [Code agent], [Agent], [Tool], [Web search], etc. |
| **Payload** | Tool failures: query, url, error. Container exit: exitCode, stderrSummary. Code/agent errors: nodeId, agentId, kind, error, stack. Browser: finalUrl, pageTitle, snippet, etc. |
| **Trail** | In run output: array of steps (nodeId, agentId, agentName, order, round, input, output, error, toolCalls). |
| **Copy for chat** | Run page builds one block (run id, status, trail summary, shell/logs with payloads) for pasting into Chat. |

### 2.2 get_run_for_improvement(runId, includeFullLogs?)

- **API:** GET run by id with query or body option for improvement context (e.g. `includeFullLogs=true`).
- **Tool:** Available to workflow agents and (when heap exists) to heap specialists. **Parameters:** `runId` (required), `includeFullLogs` (optional, default false).
- **Who decides:** The **improver agent** decides. It calls the tool; by default it does not pass `includeFullLogs`, so it gets the bounded response. If after reading the summary it decides it needs the full log text (e.g. to fix a specific Playwright or code error), it calls the tool again with `includeFullLogs: true`. No separate "decider" — the agent chooses by how it invokes the tool.
- **Improver prompt guidance:** The improvement agent’s system prompt should instruct it: "First call get_run_for_improvement(runId) to get the run summary and recent errors. Use that to plan your changes. Only call get_run_for_improvement(runId, { includeFullLogs: true }) if the summary is insufficient (e.g. you need the exact browser or code output to fix the failure)."
- **Default return (bounded):** When `includeFullLogs` is false or omitted: run metadata + **trail summary** (one line per step: nodeId, agentName, ok/error, last tool if any) + **recent errors** (last N run_log entries, e.g. N=20–30, with [source] message and truncated payload, e.g. 200–300 chars each). Cap total run_log lines (e.g. 50).
- **Full logs:** When the agent passes `includeFullLogs: true`: return full trail and full run_logs (still cap total lines if needed for safety, e.g. 200). Use only when the agent explicitly requests it.

### 2.3 "What went wrong?" one-liner (UX)

- On run page, when status is **failed** or **waiting_for_user**: show **one line** at top, e.g. "2 errors: [Playwright] navigate failed; [Run code] SyntaxError." Generated from run_logs so the user (and improver) see at a glance. Details (Execution trail, Shell logs) remain expandable.

---

## 3. Heap (multi-agent)

### 3.1 Components

| Component | Responsibility |
|-----------|----------------|
| **Router** | Small tool set (ask_user, format_response, remember). Input: user message + **list of top-level specialist ids** (≤10). Output: `priorityOrder` (array of step) + `refinedTask`. Step = string (specialist id) or `{ parallel: string[] }`. No tool defs, no run history. |
| **Heap runner** | Runs steps in order. Sequential: run one specialist, append result to context. Parallel: Promise.all on listed specialists, merge results. If specialist returns `delegateHeap`, push heap onto stack, run delegate heap (depth limit 4–5), pop, continue. Validate step ids against registry; strip unknown; fallback if heap empty. |
| **Specialists** | Each has own prompt and ≤10 tools. Some have `delegateTargets` (≤10); those can return `delegateHeap` + optional `delegateTask`. |
| **Context between steps** | **Structured summary only** (e.g. step id, outcome, 1–2 lines). No full JSON dumps. Cap total context from previous steps (e.g. last 2 steps or 500 tokens). |
| **Registry** | Holds specialist ids, per-specialist tool arrays, optional delegateTargets. Can be loaded from DB or store. **Current phase:** the registry is **not** updated by the improver (static or manually managed list). **Later:** design should allow improver `create_agent` or register_specialist to add new specialists so the next heap run sees them. |

### 3.2 Caps

- **Subnode cap = 10** everywhere: tools per specialist, top-level specialist ids, delegateTargets.
- **Branching factor:** Router top-level ≤ 7; each delegator delegateTargets ≤ 7 (per rules).

### 3.3 Key files

- `packages/runtime/src/chat/tools/` (tool sets, registry)
- New heap runner module
- `packages/ui/app/api/chat/route.ts` (heap mode flag, runRouter, run heap)

---

## 4. Self-improvement (run until goal achieved)

### 4.1 Loop

```
run task → (optional: goal checker) → ask user: goal achieved? → if No: improve → run again → … until user says Done
```

- **Run task:** Standalone workflow **or** (when heap mode on) router → heap run. Run logs (trail + run_logs) persisted.
- **Goal checker (optional):** `evaluate_goal(runOutput, taskDescription)`. Advisory only; result shown as one line in ask-user message. **Input = run summary** (trail summary + last K errors), not full trail + full logs (token minimal).
- **Ask user:** Mandatory. `request_user_help` with "Is the goal achieved?" and **two actions**: Done | Retry. Optional note under Retry (collapsed by default).
- **Improve:** On Retry: load run via `get_run_for_improvement(runId)` (bounded), optional user note, optional `get_feedback_for_scope(targetId, label?, limit?)`; run improver (**workflow only** in this phase; see §4.3); then start new task run.
- **Run again:** Same task (workflow or heap). Loop until user says Done.

### 4.2 Improvement scope (what the improver can change)

| Capability | Tools / mechanism |
|------------|-------------------|
| Prompts | `refine_agent_from_run`, `update_agent` (definition.systemPrompt, steps) |
| Code | `get_run_for_improvement` + LLM → `update_agent` (definition.source) |
| Tools | `create_tool`, `update_tool` |
| Workflows | `get_workflow`, `update_workflow`, `add_workflow_edges`, `create_workflow` |
| Agents (workflow) | `create_agent`, `update_agent` for **workflow agents** (used in workflow graphs). **Current phase:** the improver does **not** register agents as heap specialists or change the specialist registry. **Later:** improver-created agents could be registered as heap specialists. |
| Technique / playbook | `record_technique_insight`, `get_technique_knowledge` |

### 4.3 Improvement tools and execution (improver does not touch heap in this phase)

- **Tools (exposed to workflow execution context):** `get_run_for_improvement(runId, includeFullLogs?)`, `refine_agent_from_run` (optional), `update_agent`, `create_agent`, `create_tool`, `update_tool`, `get_workflow`, `update_workflow`, `add_workflow_edges`, `record_technique_insight`.
- **Current phase:** Improvement runs **only as a workflow** (e.g. "Improve from run" with one agent that has these tools, invoked with runId + optional user note). On Retry, we run that workflow; we do **not** run the heap or add an "improvement" specialist to the heap registry. The **Agentron multi-agent (heap) architecture is untouched by the improver** — the improver only updates workflow agents, tools, and workflows.
- **Later (possible):** Improvement could also run as a **heap specialist** (e.g. "improvement" specialist in the registry); on Retry the system could run the heap with context runId and the router could return that specialist. The improver could create agents that are **registered as heap specialists** so the next heap run sees them. The design (tool exposure, registry abstraction) should keep this possible without a big rework.

### 4.4 Per-agent self-improvement config

- **Where:** Workflow editor (agent node panel) and optionally Agent editor (inherit). Default = no config.
- **One toggle (UI):** "Ask me before retrying" — **On** (default): always ask "goal achieved?" and only retry when user clicks Retry. **Off**: may auto-improve and retry (e.g. up to 2 times) when run fails or checker says needs improvement, without asking.
- **Behind "More options":** Feedback interval (at end / every N steps / on failure only / every step); store as `feedbackPolicy` or `feedbackEveryNTurns` (and N).
- **Storage:** Workflow node parameters (e.g. `parameters.allowSelfImproveWithoutUser`, `parameters.feedbackPolicy`) and/or workflow-level config and/or agent definition (`definition.selfImproveConfig`). Support workflow default + per-node override.
- **Runtime:** At feedback turn (by policy), show request_user_help. If allowSelfImproveWithoutUser and (run failed or checker said improve), optionally auto-run improvement and retry (cap e.g. max 2 auto-retries).

### 4.5 Relevant feedback: get_feedback_for_scope

- **Phase 1:** Tool/API `get_feedback_for_scope(targetId, label?, limit?)` — returns feedback rows for that agent/workflow, optional filter by label (good/bad), order by createdAt, limit 20–30. **Short rows:** per row prefer summary (notes + one line for input/output); full input/output only for last 1–2 if needed (token minimal).
- **Phase 2 (optional):** RAG over feedback for similarity-based retrieval (query = current run + user feedback). Start with Phase 1.

---

## 5. UI/UX (minimal interactions)

### 5.1 Principles

- Interact only when necessary.
- One place per task; fewer choices (Done / Retry; feedback optional).
- Progressive disclosure; state visible when relevant; token usage minimal (see §6).

### 5.2 Feature-by-feature

| Feature | Where | What user sees / does | Minimal because |
|--------|--------|------------------------|------------------|
| **Heap vs standard** | Chat settings only | One control: Standard \| Multi-agent. Default Standard. | No interaction unless they open settings. |
| **Goal achieved?** | Run page (when waiting) | Question + two actions: **Done** \| **Retry**. Goal checker hint (one line, muted). | One decision; feedback optional, collapsed. |
| **Optional note** | Run page, under Retry | "Add a note (optional)" — expand to type. Submit = click Retry (same button). | No extra flow; one Retry click with or without note. |
| **Retry** | Run page (and optionally Chat link) | One button. No form, no confirmation. After: "Improving… then retrying." "What changed?" only on demand (link). | One click; no follow-up unless they ask. |
| **Self-improvement** | Workflow editor (agent node) | One toggle: "Ask me before retrying"; rest under "More options". | Default = no config; one toggle if needed. |
| **What went wrong** | Run page | One-line summary when failed/waiting; Execution trail + Shell logs expandable; Copy for chat. | No click needed to understand. |
| **Run type** | Run page, Chat | Badge "Multi-agent" when heap mode used. | Passive; no interaction. |

### 5.3 Copy and behavior

- **Done** — Goal achieved; run completes.
- **Retry** — Improve from this run's logs (and optional note), then run again. One action.
- **Add a note (optional)** — Placeholder e.g. "What went wrong? (optional)". If they fill it and click Retry, we pass it as user feedback to the improver.
- **Ask me before retrying** — On: we always ask. Off: we may auto-improve and retry (up to 2 times) when something fails.

---

## 6. Token usage (minimal)

### 6.1 Per consumer

| Consumer | Receives | Minimization |
|----------|----------|--------------|
| **Router** | User message + specialist ids (≤10). | No tool defs, no run history, no full trail. |
| **Specialists** | Own prompt + own tools (≤10) + context from previous steps. | Context = structured summary only; cap (e.g. last 2 steps or 500 tokens). |
| **Chat** | History + tools + message. | History compression (summarize old, keep recent N). Skip-LLM paths for deterministic actions. |
| **Goal checker** | Run output + task description. | Input = run summary (trail summary + last K errors), not full trail + full logs. |
| **Improvement** | get_run_for_improvement + user note + get_feedback_for_scope. | get_run bounded by default; get_feedback short rows; one LLM call when possible. |

### 6.2 get_run_for_improvement (bounded)

- **Default** (agent does not pass `includeFullLogs`): run metadata + trail summary + recent errors (last N run_log lines, N e.g. 20–30; payload truncate e.g. 200–300 chars). Cap total run_log lines (e.g. 50).
- **Full logs:** When the **agent** decides it needs more (e.g. summary is insufficient), it calls the tool again with `includeFullLogs: true`. Improver prompt should tell it to prefer the default and only request full logs when necessary.

### 6.3 get_feedback_for_scope (short rows)

- Limit rows (20–30); order by createdAt.
- Per row: short summary (notes + one line for input/output); full input/output only for last 1–2 if needed.

### 6.4 Improvement step

- Prefer **one** improver LLM call: input = summarized run + user note (if any) + summarized feedback. Output = concrete edits (update_agent, record_technique_insight, etc.). If planner + improver are two calls, keep planner output tiny (e.g. one paragraph).
- Prefer a single tool "suggest prompt from run" (bounded input) over get_run + get_agent + raw LLM with full run.

### 6.5 Caching and tracking

- **Prompt caching:** Use provider support (e.g. OpenAI) for system prompt and tool definitions so repeated calls don't resend same tokens.
- **Token tracking:** Persist `token_usage`; use to monitor chat vs heap vs improvement and to tune caps.

### 6.6 Token checklist

| Area | Action |
|------|--------|
| Router | Only specialist ids (and short labels); no tools, no history. |
| Heap context | Structured summary between steps; cap (e.g. last 2 steps or 500 tokens). |
| get_run_for_improvement | Default: metadata + trail summary + recent errors (cap N, truncate payloads). Full only on request. |
| get_feedback_for_scope | Limit 20–30 rows; short summary per row; full for last 1–2 if needed. |
| Goal checker | Input = run summary + last errors. |
| Improvement | One LLM call with summarized inputs when possible. |
| Chat | History compression; skip-LLM for deterministic actions. |
| Caching | Use provider prompt caching where available. |

---

## 7. Implementation order (single list)

1. **Run logs (already largely done)** — Ensure run_logs have source tags and payloads everywhere (Playwright, Run code, Container, Code agent, Agent, Tool). Run page: one-line "what went wrong" when failed/waiting; Copy for chat includes payloads.
2. **get_run_for_improvement (API + tool, bounded)** — API returns run metadata + trail summary + recent errors (cap N, truncate payloads). Option includeFullLogs. Tool for workflow/heap. Used by improver.
3. **get_feedback_for_scope (API + tool)** — Returns feedback rows for targetId (label?, limit 20–30); short summary per row. Improvement planner/improver calls it.
4. **Specialist registry and tool sets (dynamic from day one)** — Module under `packages/runtime/src/chat/tools/`: per-specialist tool arrays, delegateTargets, top-level list. Cap 10. Registry loads from dynamic source (abstraction getRegistry() so we can switch to DB).
5. **Router and heap runner** — Router: output priorityOrder + refinedTask (step = id or { parallel: [ids] }). Heap runner: sequential, parallel (Promise.all + merge), heap stack for delegateHeap, depth limit 4–5, validation, context summary. Unit tests (no LLM; fixed router output, mock runSpecialist).
6. **Chat route: heap mode** — Setting "Use multi-agent heap" (in chat settings). When on: runRouter → run heap; traceId; logging. When off: current runAssistant. Integration tests with mocks.
7. **Improvement tools in execution context** — Expose get_run_for_improvement, create_agent, update_agent, create_tool, update_tool, get_workflow, update_workflow, add_workflow_edges, record_technique_insight, optional refine_agent_from_run to **workflow** execution context (improver runs as a workflow in this phase; heap specialist exposure can be added later if we allow improvement as a heap specialist).
8. **Goal achieved? and Retry (UX + backend)** — Convention: task ends with request_user_help "Is the goal achieved?" options Done | Retry (optional note under Retry). Goal checker: evaluate_goal with run summary only. UI: Run page shows two buttons (Done, Retry) and optional "Add a note"; Retry triggers **improvement workflow** (e.g. "Improve from run") then new run. Improver does not touch heap.
9. **Improvement specialist (later)** — **Not in current scope.** When we allow improver→heap integration: add "improvement" specialist to registry with improvement tools; on Retry optionally run heap with context runId so router can return this specialist. Design (getRegistry(), tool exposure) should keep this possible.
10. **Registry wired to DB/store** — Registry loads from DB (e.g. agents with specialist flag or specialist_registry table) or store for a **fixed or manually managed** list of specialists. **Current phase:** improver does **not** add to the registry (create_agent creates workflow agents only; they are not registered as heap specialists). **Later:** allow improver create_agent or register_specialist to add new specialists so the next heap run sees them.
11. **Per-agent self-improvement config** — Workflow node (and optionally agent) params: allowSelfImproveWithoutUser, feedbackPolicy/feedbackEveryNTurns. UI: one toggle "Ask me before retrying"; rest under "More options". Runtime: when to ask, when to auto-improve; max auto-retries.
12. **Token bounds in get_run_for_improvement and get_feedback_for_scope** — Enforce default bounded return (trail summary + recent errors, cap/truncate); short feedback rows. Goal checker receives run summary only.
13. **Heap context cap** — Between steps: structured summary only; cap (e.g. last 2 steps or 500 tokens). Document in heap runner.
14. **Chat: history compression and skip-LLM** — Already in place; ensure settings (historyCompressAfter, historyKeepRecent) and confirmation paths (shell approve, delete confirm) remain. No new token work except optional prompt caching if provider supports.
15. **Tests (no LLMs when possible)** — Unit: heap runner (sequential, parallel, depth, validation, context merge), registry (caps). Integration: heap mode on/off, run-improve loop (task → ask → Retry → improve → run again). All mocks: router, runSpecialist, get_run_for_improvement, update_agent, LLM. No real LLM in CI.
16. **Docs and ADR** — Architecture doc, ADR for heap + self-improvement + run logs + UX + token strategy. Code comments for caps and bounded APIs.

---

## 8. Testing

### 8.1 Principle

Tests run **without real LLM calls** where we test code paths, data flow, tool execution. Use deterministic mocks.

- **Mock:** Router output (fixed priorityOrder + refinedTask). runSpecialist, executeTool, get_run_for_improvement, update_agent (and any LLM) return fixed values.
- **Statistical behavior** (non-deterministic LLM) is handled in production by human-in-the-loop and self-improvement; tests do not rely on "good" or "bad" model output.

### 8.2 Heap

- **Unit:** Heap runner sequential/parallel/depth/validation/context merge; registry caps (≤10 tools, ≤10 top-level, ≤10 delegateTargets); router output parsing.
- **Integration:** Heap mode on — single specialist; multi-step; parallel step; delegator; specialist failure. Heap mode off — unchanged. All with mocked router and runSpecialist.

### 8.3 Run-improve

- **Integration:** Task run → "goal achieved?" → user selects Retry → improvement runs (get_run_for_improvement + update_agent or create_agent with mocked data) → next task run uses updated agent or new specialist. Mock get_run_for_improvement (fixture); mock improver LLM (fixed update payload).

### 8.4 Test data

- Minimal registry: 2–3 specialists, 1–2 tools each; one delegator with 2 delegateTargets. No real LLM provider in CI.

---

## 9. Checklist (todos)

- [ ] **Run logs** — Source tags and payloads everywhere; run page one-liner "what went wrong"; Copy for chat with payloads.
- [ ] **get_run_for_improvement** — API + tool; default bounded (metadata + trail summary + recent errors, cap/truncate); includeFullLogs option.
- [ ] **get_feedback_for_scope** — API + tool; targetId, label?, limit; short summary per row.
- [ ] **Registry and tool sets** — Dynamic source; cap 10; getRegistry() abstraction.
- [ ] **Router and heap runner** — Router contract; heap runner (sequential, parallel, delegators, depth, validation, context summary); unit tests.
- [ ] **Chat heap mode** — Setting; runRouter → run heap; traceId; integration tests.
- [ ] **Improvement tools** — Expose in workflow execution context (improver runs as workflow; heap untouched).
- [ ] **Goal achieved? + Retry** — Convention request_user_help Done | Retry; optional note; goal checker with run summary; UI two buttons; Retry → improvement workflow → new run.
- [ ] **Improvement specialist (later)** — Deferred: improvement as heap specialist; design should allow it.
- [ ] **Registry from DB** — Load specialist list from DB/store; improver does not add to registry in this phase. Later: improver create_agent could register as specialist.
- [ ] **Per-agent self-improvement config** — allowSelfImproveWithoutUser, feedbackPolicy; UI one toggle + "More options"; runtime behavior.
- [ ] **Token bounds** — get_run_for_improvement and get_feedback_for_scope defaults; goal checker run summary; heap context cap.
- [ ] **Chat** — History compression and skip-LLM paths (maintain); optional prompt caching.
- [ ] **Tests** — Unit + integration for heap and run-improve; all mocks, no real LLM.
- [ ] **Docs** — Architecture, ADR, code comments.

---

**Current vs later: improver and heap.** In the current phase the self-improving agent (improver) **does not touch** the Agentron multi-agent (heap) architecture: it runs only as a workflow, updates only workflow agents and workflows, and does not register agents as heap specialists or add an improvement specialist to the registry. The heap (router, specialists, runner, registry) is built for Chat and can use a static or manually managed specialist list. The design (registry abstraction, tool exposure) **should keep it possible** to allow improver→heap integration later (e.g. improver-created agents as specialists, improvement as a heap specialist).

End of master plan. This document is the single source of truth for heap, self-improvement, improved run logs, minimal-interaction UX, and minimal token usage.
