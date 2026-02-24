# Run log improvement plan

**Goal:** Make the run log detailed enough so that a user or another agent can improve the executing agent from successful and unsuccessful tries. The “Copy for chat” block and the run detail UI should support debugging and post-hoc analysis (e.g. why did Saved Searches 404? what did the page actually show?).

---

## Current state (gaps)

1. **Trail only shows high-level tool outcome**
   - Each tool appears as: `std-browser-automation (navigate, url: …) → ok` or `→ Web search failed`.
   - No *what actually happened*: final URL after redirects, page title, selector found/not found, or snippet of page content.

2. **Shell / container logs are minimal for browser**
   - For `std-browser-automation`, only one line is written *before* the call: `Browser: navigate url=...` (see `run-workflow.ts` ~952–959).
   - Nothing is logged *after* the call: no result summary, no final URL, no error detail (e.g. timeout vs selector missing vs “Sorry, we couldn’t find that page”).

3. **Playwright session has no structured logging**
   - `browser-automation.ts` returns `{ success, content? }` or `{ success: false, error }` but does not report:
     - Final URL and page title after `navigate`
     - For `getContent`: length or a short text summary (e.g. first 500 chars or “contains: Sorry, we couldn’t find that page”)
     - For `click` / `fill` / `waitFor`: whether the selector was found and visible, or timeout/not found
   - None of this is passed to `run_logs`, so the “Copy for chat” block and UI never see it.

4. **Failures are opaque**
   - “Web search failed” with no query or error message in the log.
   - Browser errors are only in the tool *return value* (and briefly in `resultSummary`); they are not duplicated into `run_logs` in a consistent, parseable way.

5. **No timing**
   - No timestamps or durations per step/tool, so you can’t see where time was spent or correlate with timeouts.

6. **Copy-for-chat block doesn’t include tool outputs**
   - Execution trail shows “Tools invoked: … → ok” but not a summary of *what* was returned (e.g. “page title: X, content length: Y” or “error: …”). So someone pasting the block doesn’t give the debugging agent the actual outcomes.

---

## What to add (recommended)

### 1. Detailed Playwright / browser session logs (priority 1)

**Where:** `packages/ui/app/api/_lib/browser-automation.ts` and the caller in `run-workflow.ts`.

- **Option A – Callback from browser automation**
  - Add an optional `onLog?: (entry: { level: 'stdout'|'stderr'; message: string; payload?: object }) => void` to the browser-automation context.
  - From `browserAutomation()`, after each action:
    - **navigate:** Log success with `finalUrl`, `pageTitle` (from `page.url()`, `page.title()`). On failure, log the thrown error message.
    - **getContent:** Log success with `contentLength`, optional `contentSnippet` (e.g. first 300 chars of text, or “contains: …” if it matches a known error phrase like “couldn’t find that page”).
    - **click / fill / waitFor:** Log success (“selector found”) or failure with reason (timeout, not found, not visible).
    - **screenshot:** Log success with size or “captured”.
  - In `run-workflow.ts`, when calling the browser tool, pass a context that implements `onLog` by inserting into `run_logs` (same schema: `level`, `message`, optional `payload` as JSON string).

- **Option B – Log only in run-workflow from return value**
  - Keep browser-automation return shape but extend it with a `logEntries?: Array<{ level, message, payload? }>`.
  - After `executeStudioTool(..., "std-browser-automation", ...)`, if `result.logEntries` is present, insert each into `run_logs`. Browser automation would then populate `logEntries` from inside each branch (navigate, getContent, etc.).

Recommendation: **Option A** keeps logging concern in one place (run_logs) and avoids large return payloads; the browser module stays focused on “do the action and report outcome.”

**Concrete in `browser-automation.ts`:**
- After successful `page.goto()`: call `onLog?.({ level: 'stdout', message: \`Browser: navigate completed\`, payload: { finalUrl: page.url(), pageTitle: await page.title() } })`.
- After failed `page.goto()`: already return `{ success: false, error }`; caller can log that (see below). Optionally also call `onLog?.({ level: 'stderr', message: \`Browser: navigate failed: ${navMsg}\`, payload: { url } })`.
- After `getContent`: `onLog?.({ level: 'stdout', message: \`Browser: getContent\`, payload: { contentLength: snippet.length, snippet: snippet.slice(0, 300), hasKnownErrorPage: /couldn't find that page/i.test(snippet) } })` (snippet only if small enough or redacted).
- For click/fill/waitFor: on success log “selector found”; on catch log “selector timeout/not found” and selector (truncated).

**Concrete in `run-workflow.ts`:**
- When building the context for `executeStudioTool` for `std-browser-automation`, pass an `onLog` that does:
  - `await db.insert(runLogs).values({ id: crypto.randomUUID(), executionId: runId, level: entry.level, message: entry.message, payload: entry.payload ? JSON.stringify(entry.payload) : null, createdAt: Date.now() }).run();`
- After *any* tool call that returns `result` with `result.error` or `result.success === false`, insert a run_log line (you already do for `toolErrorMsg`); ensure the message includes a short, readable summary so “Copy for chat” contains it.

### 2. Enrich “Shell / container logs” in the copy block and UI

- **Current:** `buildShellAndContainerLogText(run.logs)` only prints `[level] message`; `payload` is not shown.
- **Change:** In `packages/ui/app/runs/[id]/page.tsx`, in `buildShellAndContainerLogText`, if `e.payload` is present, append a single line or short block (e.g. `  payload: <parsed JSON summary>` or key fields like `finalUrl`, `pageTitle`). Keep it one line when possible so the paste block stays readable.
- Optionally add a “Run logs (detailed)” section in the run detail UI that shows `message` + payload (expandable) so users can inspect without copying.

### 3. Include tool result summaries in the copy block

- **Current:** Execution trail in the copy block shows “Tools invoked: … → ok” or “→ &lt;error&gt;” but not what was *in* the result (e.g. content length, final URL).
- **Change:** Either:
  - Persist a short “resultSummary” or “resultDetail” per tool call (e.g. “finalUrl: …; pageTitle: …; contentLength: 1234”) and render it in the “Execution trail (step details)” section of `buildCopyForChatBlock`, or
  - Rely on the new run_logs from (1) and add a subsection under “Shell / container logs” like “Browser session details” that lists only browser-related run_log lines (with payloads). That way the same source (run_logs) feeds both the UI and the copy block.

Recommendation: Prefer **run_logs as single source** so you don’t duplicate data: improve run_logs content (1), then in the copy block print run_logs with payloads (2). The “What happened” section can stay as now; “Shell / container logs” becomes the place for “what actually happened in the browser.”

### 4. Log tool failures and web-search failures in run_logs

- **Web search:** Where `std-web-search` is implemented, on failure log to run_logs: `message: "Tool std-web-search: failed"`, `payload: { query, errorMessage }`. If the tool is called from the same `callTool` path, you can do this in run-workflow after the call when `toolErrorMsg` is set, and include the last tool’s args (e.g. query) in the payload.
- **Any tool:** You already insert when `toolErrorMsg` is set; ensure the `message` is descriptive and, if needed, add a second insert with `payload` containing sanitized args (e.g. query, url) for debugging.

### 5. Optional: timestamps and durations

- **run_logs:** Already have `createdAt`. No change needed for “when.”
- **Trail steps:** Optionally add `startedAt` / `finishedAt` (or a single `timestamp`) when you push to `trail`. Then in the copy block you can add “Step #1 started at …” or “Duration: … ms” so an improving agent can see timeouts and slow steps.
- Lower priority than (1)–(4).

### 6. Optional: include a short “state at request_user_help” in the copy block

- When status is `waiting_for_user`, add a line like: “At this point the agent had tried: …” with the last N tool calls and their outcomes (from trail + run_logs). That gives the human or the debugging agent immediate context without scrolling the whole trail.

---

## Implementation order

1. **Browser automation logging (1)**  
   Add `onLog` to browser context; implement in `browser-automation.ts` for navigate, getContent, click, fill, waitFor; wire `onLog` in run-workflow to insert into `run_logs`.

2. **Show payload in shell logs (2)**  
   Update `buildShellAndContainerLogText` (and optionally the run detail UI) to include payload for run_log entries.

3. **Web search and tool failure payloads (4)**  
   Ensure every tool failure writes a run_log line with enough context (query, url, error message); optionally add payload for successful but “empty” results (e.g. web search returned no results).

4. **Copy block wording (3)**  
   Add a short “Browser session” subsection that pulls browser-related run_log lines with payloads, or add one-line result summaries per tool in the execution trail.

5. **Timing / state summary (5, 6)**  
   Add if you still need them after (1)–(4).

---

## Files to touch

| Area | File | Change |
|------|------|--------|
| Browser logging | `packages/ui/app/api/_lib/browser-automation.ts` | Add `onLog` to context; call it after each action with message + payload (finalUrl, pageTitle, contentLength, snippet, selector outcome). |
| Run logs insert | `packages/ui/app/api/_lib/run-workflow.ts` | For std-browser-automation, pass context with `onLog` that inserts into `run_logs`; optionally enrich tool-error insert with payload (query, url). |
| Copy block & UI | `packages/ui/app/runs/[id]/page.tsx` | `buildShellAndContainerLogText`: include payload (one line or key fields); optionally add “Browser session” subsection from run_logs filtered by message prefix. |
| Web search | Where std-web-search is implemented | On failure, ensure run_logs get a line with query and error (or do it in run-workflow from tool result). |

**Implemented (code & container errors):** Agent execution errors (code or LLM node) are persisted to run_logs with `nodeId`, `agentId`, `kind`, `error`, `stack`. std-run-code failures include `language`, `codeSnippet`, `stderr`. Container runs that exit with non-zero code get a run_log line with `exitCode` and `stderrSummary`.

This keeps the run log as a single, detailed timeline (run_logs + trail) so that “Copy for chat” and any improving agent have a clear picture of what was tried, what succeeded, what failed, and what the browser actually showed.
