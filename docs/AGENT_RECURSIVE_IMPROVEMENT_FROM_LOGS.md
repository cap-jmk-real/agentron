# How a workflow agent can recursively improve itself using run logs

**Scope:** An **agent** (workflow node or dedicated “improver” workflow), **not** the Agentron chat assistant, uses the **run logs** we persist (trail + run_logs with payloads) to improve the same or another agent. This plan is about the **data, tools, and loop** so that any workflow you design can “read a failed run and update the agent.”

---

## 1. What we have today

| Piece | Status |
|-------|--------|
| **Run logs** | Persisted for every workflow run: browser (finalUrl, pageTitle, getContent snippet, selector outcomes), code/agent errors (nodeId, kind, error, stack), std-run-code (language, codeSnippet, stderr), container exit (exitCode, stderrSummary), tool failures (query, url, action, etc.). |
| **Trail** | Per-step input/output, tool calls (name + argsSummary + resultSummary), step errors. Stored in `executions.output.trail`. |
| **Copy-for-chat block** | Built from trail + run_logs (with payloads); one paste gives full context for debugging. |
| **get_run (chat tool)** | Returns run id, status, output (with trail). **Does not** return run_logs. So an agent that calls get_run today **does not see** browser/code/container detail. |
| **Refine (API)** | POST /api/agents/:id/refine uses **feedback table** (user ratings) + LLM to suggest new system prompt/steps. No run_logs input. |
| **Improvement tools (chat)** | create_improvement_job, generate_training_data, trigger_training, get_technique_knowledge, record_technique_insight, etc. Designed for chat-composed improvement; some need to be callable from **workflow** context (same or new tools). |
| **Feedback** | Stored by targetId/executionId; generate_training_data(from_feedback) reads it. Run-level “Rate this run” can attach feedback to a run. |

**Gap:** An agent that wants to “improve from this run” has no way to get the **full improvement context** (trail + run_logs) in one call, and no single tool that says “given runId, suggest or apply an update to this agent.”

---

## 2. High-level loop

```
┌─────────────────────────────────────────────────────────────────┐
│  Run workflow (e.g. “LinkedIn Saved Search”)                    │
│  → run_logs + trail persisted (browser, code, container, errors) │
└────────────────────────────┬────────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
   [Manual trigger]   [Scheduled]        [On failure]
   User clicks        Cron workflow      Workflow branch
   “Improve from      “List failed       “If step failed,
    this run”          runs → improve”    call improver”
         │                   │                   │
         └───────────────────┼───────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Improvement workflow (single agent or multi-step)              │
│  Input: runId, optional targetAgentId / targetWorkflowId         │
│  1. get_run_for_improvement(runId)  → trail + run_logs (full)    │
│  2. Optionally get_agent(targetAgentId) / get_workflow(...)       │
│  3. Reason over logs: what failed? wrong URL? code error?         │
│  4. Act: update_agent (prompt/code) | record_technique_insight   │
│         | generate_training_data(..., runIds: [runId])            │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Next run of the original workflow uses updated agent            │
│  (new prompt, new code, or playbook insight injected)            │
└─────────────────────────────────────────────────────────────────┘
```

The “improving agent” is **whatever workflow + agents you design** that use the new/updated tools. No single built-in “improvement agent”; you compose it.

---

## 3. What the improving agent needs

### 3.1 Read: full run context

- **One tool:** `get_run_for_improvement(runId)` (or extend `get_run` with an option `includeLogs: true`).
- **Returns:** Everything needed to reason about the run without a second request:
  - Run metadata: id, targetType, targetId, status, startedAt, finishedAt.
  - `output`: same as today (trail, final output, error if any).
  - `logs`: array of `{ level, message, payload?, createdAt }` (run_logs for this execution), so the agent sees browser finalUrl/pageTitle, code errors and stack, container exitCode/stderrSummary, tool failure payloads (query, url, codeSnippet, etc.).
- **Format:** Either the same “copy block” text (so the model sees exactly what a human would paste) or a structured JSON. Structured is better for tool use (agent can cite step index or log line); optional `format: "text"` can return the copy block for compatibility.

**Implementation:** New API GET /api/runs/:id/for-improvement (or query param on GET /api/runs/:id) that returns run + logs. New chat/workflow tool that calls it. If workflow agents call tools via the same backend as chat, the tool handler calls this API and returns the result.

### 3.2 Write: how the agent can “improve”

The agent can change three kinds of things:

| Target | Mechanism | Exists today? |
|--------|-----------|----------------|
| **Prompt / instructions** | Update the agent’s system prompt or steps (e.g. “when Sales Navigator returns 404, first try /sales/ then Saved Searches”). | Refine exists from **feedback**; we need a path from **run** (trail + logs) → suggested prompt → update. |
| **Code (code agent)** | Update the agent’s `definition.source` (and optionally entrypoint). | No. We need “suggest code patch from run” or “propose new source” and then update_agent. |
| **Playbook / technique** | record_technique_insight(scope, technique, outcome, summary). So “when navigate to /saved-sea failed, we learned: use /sales/ first.” Next run, get_technique_knowledge can retrieve it and the agent’s prompt or context can include it. | record_technique_insight and get_technique_knowledge exist in **chat** improvement tools; they must be invokable from a **workflow** (same or dedicated improvement workflow). |

So we need:

1. **get_run_for_improvement(runId)**  
   Returns full run context (trail + logs with payloads). Implement as above.

2. **refine_agent_from_run(agentId, runId)** (new or composed)  
   - Load run via get_run_for_improvement(runId).  
   - Build a prompt: “This run failed (or had issues). Trail: …; Logs: …. Current agent prompt: …. Suggest an improved system prompt (and optional steps) so the agent does better next time.”  
   - Call LLM; parse suggested prompt/steps.  
   - Return suggestion (and optionally apply via update_agent if you add an approval flow).  
   So: either a **new tool** that does “suggest prompt from run” (and optionally “apply”), or the improving agent **calls get_run_for_improvement + get_agent**, then calls an LLM (e.g. via a “reasoning” node or a custom tool that calls the same refine logic with run context instead of feedback table).

3. **propose_agent_code_from_run(agentId, runId)** (optional, for code agents)  
   - Load run + current agent definition.source.  
   - Prompt: “Run failed. Logs: …. Current code: …. Suggest a patch or replacement that fixes the failure.”  
   - Return (or apply) suggested source.  
   Same idea: new tool or the improving agent composes get_run_for_improvement + get_agent + LLM call + update_agent.

4. **record_technique_insight** (and **get_technique_knowledge**)  
   Already in improvement tools. Ensure they are **available to workflow agents** (not only chat). Then the improving agent can record “navigate to Sales Navigator saved searches: direct URL failed; use /sales/ then click Saved Searches” and future runs can retrieve that.

5. **update_agent** (and **get_agent**)  
   Already in chat; workflow must be able to call them (or they are the same tools). So the improving agent can update prompt/code after it has a suggestion.

6. **list_runs** with filters  
   So the improving agent can find “recent failed runs for this workflow/agent.” Extend list_runs (or the runs API) with `targetId`, `status` (e.g. failed, completed, waiting_for_user), `limit`. Then a scheduled improvement workflow can list failed runs and call get_run_for_improvement on each.

---

## 4. Where the improving agent runs

- **Option A – Same workflow, “improvement” branch or final node**  
  The workflow has an extra node or branch that runs only on failure (or when the user chooses “Improve”): it receives runId (and maybe targetAgentId), calls get_run_for_improvement, then update_agent / record_technique_insight. Pros: single workflow. Cons: that node needs the right tools (get_run_for_improvement, update_agent, record_technique_insight); tools must be available in workflow context.

- **Option B – Dedicated “Improvement” workflow**  
  A separate workflow (e.g. “Improve from run”) with one agent that has tools: get_run_for_improvement, get_agent, get_workflow, update_agent, record_technique_insight, refine_agent_from_run (if we add it). User (or cron) starts this workflow with body `{ runId, targetAgentId }`. The agent’s system prompt: “You receive a runId and optional targetAgentId. Load the run, identify what went wrong from the logs and trail, then update the agent’s prompt or code or record a technique insight so the next run does better.” Pros: clear separation, reusable. Cons: need to pass runId/targetAgentId (e.g. workflow input or first node config).

- **Option C – Chat designs and starts it**  
  User says “Improve the LinkedIn workflow from run X.” Chat calls execute_workflow(workflowId: improvementWorkflowId, input: { runId: X, targetAgentId: Y }). Same as B, but triggered from chat.

Recommendation: **B + C**. Implement tools so they work in **workflow** context; then the user (or chat) creates an “Improvement” workflow and runs it with runId (and optionally targetAgentId). No fixed graph: the improvement workflow can be a single agent with many tools or multiple nodes.

---

## 5. Implementation checklist

| # | Item | Notes |
|---|------|--------|
| 1 | **get_run_for_improvement(runId)** | API: GET /api/runs/:id with ?forImprovement=1 or GET /api/runs/:id/for-improvement returning run + logs (same as run detail page). Tool: in chat route (and workflow tool adapter if separate) call this and return to the agent. |
| 2 | **get_run to include logs when requested** | Alternatively extend get_run with optional parameter includeLogs: true and merge logs into the response so one call gives full context. |
| 3 | **list_runs filters** | API: GET /api/runs?targetType=&targetId=&status=&limit=. Tool: list_runs(targetId?, status?, limit?) so the improving agent can find “failed runs for this workflow.” |
| 4 | **Refine from run (prompt)** | New tool refine_agent_from_run(agentId, runId) that: loads run (trail + logs), loads agent, calls LLM to suggest prompt/steps from run context, returns (and optionally applies) suggestion. Or: document that the improving agent should call get_run_for_improvement + get_agent and then use a generic “call_llm” or a dedicated “suggest_prompt” tool and then update_agent. |
| 5 | **Code agent: suggest code from run** | New tool propose_agent_code_from_run(agentId, runId) or same pattern: get run + agent source, LLM suggests patch, return or apply. |
| 6 | **Improvement tools in workflow context** | Ensure record_technique_insight, get_technique_knowledge, update_agent, get_agent (and create_improvement_job, generate_training_data, trigger_training if the improver should also trigger training) are invokable when a **workflow** agent calls tools. Today they may be chat-only; the workflow’s tool registry or executeStudioTool path must expose them (or a subset) for the improvement workflow. |
| 7 | **Run-level feedback from UI** | “Rate this run” on run detail so feedback is attached to runId; generate_training_data(from_feedback) can then use it. Optional: “Use this run for improvement” button that starts the improvement workflow with this runId. |
| 8 | **generate_training_data and run ids** | If generate_training_data can accept a list of runIds (in addition to feedback), the improving agent can say “include these failed runs in the next training batch” so trajectories from logs become training data. (Schema/API may need to support runIds in the dataset.) |

---

## 6. Minimal first slice (so an agent can improve itself from logs)

1. **Expose run + logs to the agent**  
   - Add `get_run_for_improvement(runId)` that returns run metadata + output (trail) + logs (with payloads).  
   - Implement in the same place as get_run (e.g. chat route + runs API).  
   - If workflows use the same tool list, the improvement workflow agent can call it.

2. **Allow workflow to call “improvement” tools**  
   - At least: get_run_for_improvement, get_agent, update_agent, record_technique_insight, get_technique_knowledge.  
   - So the improving agent can read a run, reason, update prompt or record an insight, and the next run can retrieve that insight (e.g. via get_technique_knowledge in the main agent’s context or via an updated system prompt).

3. **One “Improvement” workflow**  
   - Single agent, system prompt: “You receive runId and optional targetAgentId. Use get_run_for_improvement to load the run. From the trail and logs, identify what failed (browser URL, code error, container exit, tool error). Then either: (a) update the agent’s system prompt with update_agent so it avoids the same mistake, or (b) record_technique_insight so future runs get this knowledge. Prefer (b) for one-off lessons and (a) for broad prompt changes.”  
   - Input: runId, targetAgentId (optional).  
   - User or chat starts this workflow after a failed run; the agent has full log context and can change the target agent.

4. **Optional: refine_agent_from_run tool**  
   - Wraps “load run + load agent + LLM suggest prompt from run + return suggestion” so the improving agent can call one tool and then update_agent with the result, instead of composing get_run_for_improvement + get_agent + LLM in the open.

With this, “run → fail → run improvement workflow with runId → agent reads logs, updates prompt or records insight → next run improves” works without the chat assistant. The agent that improves is a normal workflow agent with the right tools and prompt.
