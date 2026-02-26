---
name: ""
overview: ""
todos: []
isProject: false
---

# Plan: Live turn inputs and outputs in E2E progress logs

## Goal

During a workflow E2E run (e.g. red-vs-blue), when `E2E_LOG_PROGRESS=1` or `E2E_SAVE_ARTIFACTS=1`, the progress log should show **inputs and outputs of each turn live** (not only trail length and last step’s output preview), so we can see what each agent received and produced as the run executes.

## Current behavior

- `**startWorkflowProgressLogger(workflowId)`** (in `packages/ui/__tests__/e2e/e2e-logger.ts`) polls the **executions** table every 1.5s for the row where `targetType = "workflow"`, `targetId = workflowId`, `status = "running"`.
- It reads `executions.output`, which is JSON `{ trail?, message? }`. The **trail** is updated on each step completion via `onStepComplete` in `run-workflow.ts` (and in the event-driven path the engine calls `setExecutionRunState` with `trailSnapshot`, and the run-workflow layer merges/writes output).
- The logger only logs a **single line per poll** when trail or message changes:
  - `trailLength`, `message`, `lastNodeId`, `lastAgentName`, `round`, and `outputPreview` (first 250 chars of **last** step’s output only).
- So we **do not** see:
  - The **input** for any step (what the agent received: user message / workflow memory block).
  - **Per-step** output for previous steps (only the latest step’s output preview).
  - **Tool calls** for the step (e.g. `std-http-request`, `query_cve_api`).
  - A clear “new step completed” line with that step’s input + output.

## Why inputs/outputs are missing

1. **Input:** The trail steps in `ExecutionTraceStep` include an optional `input` field. The engine does set `step.input` (the agent’s effective user message / memory block). So **input is present in the trail** in the DB; the progress logger simply **does not log it** (it only logs `lastStep.output` preview).
2. **Output:** Only the **last** step’s output is logged (as `outputPreview`). When a new step is appended, we overwrite the same line with the new “last” step; we never print the **previous** step’s output or a per-step history.
3. **Deduplication:** The logger only writes when `trail.length` or `message` changes. So when a new step is added, we get one line with the new last step. We don’t emit a dedicated “step N completed” line with that step’s full input + output.

## Proposed changes (for next run)

1. **Progress logger: use runId when available**
  - Red-vs-blue (and others) call `startWorkflowProgressLogger(workflowId)` before `execute_workflow` returns, so **runId is not yet available**. The logger therefore must keep querying by `(targetType, targetId=workflowId, status=running)` to find the running execution. Optionally: allow passing `runId` later (e.g. callback or second call) so we can poll by `executions.id = runId` for a more precise match if multiple runs exist.
2. **When trail length increases: log the new step(s) with input + output**
  - When `trail.length > lastTrailLength`, treat the **new** step(s) as “just completed.”
  - For each new step, log a dedicated progress line, e.g.:
    - `stepCompleted`, `order`, `nodeId`, `agentName`, `round`
    - `inputPreview`: first N chars of `step.input` (e.g. 300–500 chars, or truncate with “…”) so we see what the agent received.
    - `outputPreview`: first N chars of `step.output` (existing 250 or slightly more).
    - `toolCallsSummary`: if `step.toolCalls` exists, log tool names (e.g. `["std-http-request", "query_cve_api"]`) or a short summary.
  - Keep the existing “summary” line (trail length, message, last node, etc.) so we still have a single-line overview each poll.
3. **Cap length of previews**
  - Use constants (e.g. `INPUT_PREVIEW_LEN = 400`, `OUTPUT_PREVIEW_LEN` already 250) and truncate with `…` so logs stay readable and artifact files don’t explode.
4. **Optional: log “step started” when possible**
  - Today we only see “step completed” when the trail grows. We could add an `onProgress` callback that writes a “Executing: ” or “Node X started” line if the run-workflow layer exposes progress (e.g. current node id or “calling LLM”) and that is written somewhere the logger can read (e.g. in `executions.output.message` or a small “currentStep” field). Lower priority than input/output on completion.

## Implementation notes

- **Where to change:** `packages/ui/__tests__/e2e/e2e-logger.ts`, function `startWorkflowProgressLogger`.
- **Data source:** Same as now: poll `executions.output` (parsed as `{ trail?, message? }`). Each trail element is an `ExecutionTraceStep` with `input`, `output`, `toolCalls`, `nodeId`, `agentName`, `order`, `round`.
- **Backward compatibility:** Keep existing progress line format; add **additional** lines when `trail.length` increases (one “step completed” block per new step). Existing consumers that only care about trail length and last output still work.
- **Tests:** Consider a small unit test that builds a mock trail, runs the progress logger logic (or an extracted “format new steps” helper), and asserts that input/output previews and tool call names appear in the output.

## Summary


| What we want live     | Why it’s missing today                    | Fix                                                                                    |
| --------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------- |
| Input of each turn    | Logger never logs `step.input`            | When trail grows, log each new step’s `input` (truncated).                             |
| Output of each turn   | Only last step’s output preview is logged | When trail grows, log each new step’s `output` (truncated) in a “step completed” line. |
| Which tools were used | Logger doesn’t read `step.toolCalls`      | Include `toolCalls` summary (tool names) in the new “step completed” line.             |


Result: during the next run, progress logs will show each turn’s input and output (preview) and tool calls as they complete, so we can follow the run live.