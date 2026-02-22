# Plan: Increase Test Coverage to Meet Thresholds

## Targets (vitest.config.ts)

| Metric     | Target  |
|-----------|---------|
| Statements | **70%** |
| Branches   | **100%** |
| Functions  | **70%** |
| Lines      | **70%** |

Improve coverage **by adding tests only**; do not exclude in-scope code to hit targets (see `.cursor/rules/coverage-and-test-failures.mdc`).

**In scope:** `packages/ui/app/**/*.ts` except paths listed in `vitest.config.ts` → `coverage.exclude`. Excluded areas (chat route, ollama, sandbox, run-workflow, s3, etc.) are documented in `packages/ui/__tests__/README.md`.

---

## Core rule: one file at a time, finish before moving on

- Work **lib-by-lib** and **route-by-route**.
- **When you touch a file, finish it before moving on.** “Finished” means:
  - Every **branch** in that file is covered (or explicitly documented as unreachable in a comment + excluded if appropriate).
  - Every **line** and **function** in that file that is reachable is covered.
- Use `packages/ui/coverage/index.html` (after `npm run test:coverage`) to see uncovered lines/branches for the file you’re working on. Add tests until that file shows 100% branches and full line/function coverage for in-scope code.
- Do not start another in-scope file until the current one is done.

---

## How to work through the plan

1. Run from repo root: `npm run test:coverage` (or from `packages/ui`: `vitest run --coverage`).
2. Open `packages/ui/coverage/index.html` and navigate to the file you’re working on.
3. Add or extend tests in the corresponding test file (see tables below). Run `npm test --workspace=packages/ui` (or filter by test file) after changes.
4. Re-run coverage and confirm the **single file** you were working on now has 100% branches and full line/statement/function coverage.
5. Only then move to the next file in the list.

---

## Part A: _lib files (finish one file completely before the next)

Test path: `packages/ui/__tests__/api/_lib/<name>.test.ts` (create if missing).

Order: start with small/pure modules, then those used by many routes.

| # | Source file (app/api/_lib/) | Test file | Definition of done |
|---|-----------------------------|-----------|--------------------|
| 1 | response.ts | response.test.ts | All branches (init/headers merge); 100% lines/functions. |
| 2 | store.ts | store.test.ts | All branches; 100% lines/functions. |
| 3 | naming.ts | (used by routes; no standalone _lib test) | Covered via route tests; if a dedicated unit test exists, finish it. |
| 4 | api-logger.ts | api-logger.test.ts | All branches (getLogPath fallback, getFallbackLogPath, writeLogLine fallback, getLogExcerpt paths, probeLogWritable). |
| 5 | rag-limits.ts | rag-limits.test.ts | All branches; 100% lines/functions. |
| 6 | execution-log.ts | execution-log.test.ts | All branches (capPayload string/object/truncate, getNextSequence empty); 100% lines/functions. |
| 7 | feedback-for-scope.ts | (route tests) | Ensure feedback-for-scope routes and any _lib helpers are fully covered. |
| 8 | feedback-retrieval.ts | feedback-retrieval.test.ts | All branches; 100% lines/functions. |
| 9 | telegram-sessions.ts | telegram-sessions.test.ts | All branches; 100% lines/functions. |
| 10 | telegram-settings.ts | (via settings-telegram tests) | All branches used by settings/telegram routes. |
| 11 | telegram-update.ts | (via telegram webhook/route tests) | All branches used by telegram webhook. |
| 12 | reminder-scheduler.ts | (via reminders route tests) | All branches; add unit tests if needed. |
| 13 | notifications-store.ts | (via route tests that trigger notifications) | All branches (createRunNotification, etc.). |
| 14 | chat-event-channel.ts | chat-event-channel.test.ts | All branches; 100% lines/functions. |
| 15 | chat-helpers.ts | chat-helpers.test.ts | All branches; 100% lines/functions. |
| 16 | chat-queue.ts | chat-queue.test.ts | All branches; 100% lines/functions. |
| 17 | credential-store.ts | credential-store.test.ts | All branches; 100% lines/functions. |
| 18 | vault.ts | vault.test.ts | All branches (derive, encrypt, decrypt, buildVaultCookieHeader, getVaultKeyFromRequest); 100% lines/functions. |
| 19 | app-settings.ts | app-settings.test.ts | All branches (loadRaw, save, all normalizers, getAppSettings, updateAppSettings); 100% lines/functions. |
| 20 | embeddings.ts | embeddings.test.ts | All branches; 100% lines/functions. |
| 21 | rag.ts | rag.test.ts (in _lib) | All branches; 100% lines/functions. |
| 22 | rag-extract.ts | rag-extract.test.ts | All branches; 100% lines/functions. |
| 23 | vector-store-query.ts | vector-store-query.test.ts | All branches; 100% lines/functions. |
| 24 | execution-events.ts | execution-events.test.ts | All branches; 100% lines/functions. |
| 25 | db-mappers.ts | (via route tests; add _lib/db-mappers.test.ts if needed) | All branches used by API; 100% lines/functions. |
| 26 | db.ts | (via route tests; add unit tests for pure helpers if any) | All branches for in-scope usage. |
| 27 | system-stats.ts | (via system-stats route tests) | All branches; 100% lines/functions. |
| 28 | shell-exec.ts | shell-exec.test.ts | All branches; 100% lines/functions. |
| 29 | container-manager.ts | (via route tests) | All branches (verifyContainerEngine, withContainerInstallHint, etc.). |
| 30 | workflow-queue.ts | workflow-queue.test.ts | All branches; 100% lines/functions. |
| 31 | scheduled-workflows.ts | scheduled-workflows.test.ts | All branches; 100% lines/functions. |
| 32 | run-workflow-constants.ts | (via execute-tool / workflow tests) | All branches. |
| 33 | run-scheduled-workflow.ts | run-scheduled-workflow.test.ts | All branches; 100% lines/functions. |
| 34 | run-scheduled-turn.ts | (via route tests) | All branches. |
| 35 | run-for-improvement.ts | (via runs-for-improvement route tests) | All branches. |
| 36 | run-workflow-tool-execution.ts | run-workflow-tool-execution.test.ts | All branches; 100% lines/functions. |
| 37 | run-workflow-engine.ts | (via execute/workflow tests; large file) | All branches that are testable with mocks; document untestable paths. |
| 38 | run-workflow-containers.ts | (via workflow/execute tests) | All branches that are testable. |
| 39 | run-workflow-engine.ts (chat _lib) | execute-tool.test.ts, chat tests | Cover execute-tool and chat _lib usage; finish remaining branches. |
| 40 | specialist-overrides.ts | (via heap/execute-tool tests) | All branches. |
| 41 | sandbox-site-bindings.ts | (excluded or integration) | If in scope: cover; else document. |
| 42 | browser-automation.ts | browser-automation.test.ts | All branches that run in Node (no real browser); document browser-only. |
| 43 | github-settings.ts | github-settings.test.ts | All branches; 100% lines/functions. |
| 44 | github-api.ts | github-api.test.ts | All branches; 100% lines/functions. |
| 45 | github-reported-runs.ts | github-reported-runs.test.ts | All branches; 100% lines/functions. |
| 46 | run-failure-side-effects.ts | run-failure-side-effects.test.ts | All branches; 100% lines/functions. |

**Excluded from scope (do not add to coverage work):**  
`api/_lib/s3.ts`, `remote-test.ts`, `run-workflow.ts`, `openclaw-client.ts`, `telegram-polling.ts` (see vitest.config.ts).

---

## Part B: Route files (finish one route file completely before the next)

Test path: `packages/ui/__tests__/api/<area>.test.ts` or the appropriate existing test file (e.g. runs-logs.test.ts for runs).

**Definition of done per route:** 100% branch coverage and full line/function coverage for that route file. Use `coverage/index.html` → open the route file and add tests until no red (uncovered) branches/lines remain.

### B.1 Runs

| # | Route file | Test file | Notes |
|---|------------|-----------|--------|
| 1 | api/runs/route.ts | runs-logs.test.ts | GET: no runs, only workflow runs, only agent runs, orphan workflow/agent, limit, targetType/targetId. |
| 2 | api/runs/[id]/route.ts | runs-logs.test.ts | GET 404, GET with logs, PATCH 404/400, PATCH no-op body, PATCH status+output, PATCH when createRunNotification throws. |
| 3 | api/runs/[id]/trace/route.ts | runs-logs.test.ts | GET 404, output null/array/object with trail, workflow/agent targetName, deleted workflow/agent. |
| 4 | api/runs/[id]/agent-request/route.ts | runs-logs.test.ts | GET 404, not waiting_for_user, output string/object, parse error, non-object, all question/options/suggestions branches. |
| 5 | api/runs/[id]/events/route.ts | runs-logs.test.ts | GET 404, GET 200, runState branches. |
| 6 | api/runs/[id]/messages/route.ts | runs-logs.test.ts | GET 404, GET 200, limit/clamp. |
| 7 | api/runs/[id]/for-improvement/route.ts | runs-for-improvement.test.ts | All branches. |
| 8 | api/runs/pending-help/route.ts | runs-logs.test.ts | Filter branches (null/empty/validConvIds), workflowIds/agentIds empty vs non-empty, output parse, question/reason/suggestions branches. |

### B.2 Workflows

| # | Route file | Test file | Notes |
|---|------------|-----------|--------|
| 9 | api/workflows/route.ts | workflows.test.ts | GET, POST (name, no name), validation. |
| 10 | api/workflows/[id]/route.ts | workflows.test.ts | GET 404/200, PUT, DELETE. |
| 11 | api/workflows/[id]/execute/route.ts | workflows.test.ts | POST 200, body NaN/invalid/valid, maxSelfFixRetries clamp, waitForJob success/WaitingForUserError (trail/empty)/cancelled/generic/non-Error. |
| 12 | api/workflows/[id]/rollback/route.ts | workflows.test.ts | 404 workflow/version, 400 snapshot mismatch, 500 invalid snapshot, 200 by versionId/version. |
| 13 | api/workflows/[id]/versions/route.ts | workflows.test.ts | GET 404, GET 200 empty/list. |
| 14 | api/workflow-queue/route.ts | workflow-queue-route.test.ts | All branches. |

### B.3 Settings

| # | Route file | Test file | Notes |
|---|------------|-----------|--------|
| 15 | api/settings/app/route.ts | settings-app.test.ts | GET 200/500, PATCH all branches (maxFileUploadBytes, containerEngine, allowlist, addShellCommand, web search keys, workflowMaxSelfFixRetries), splitShellCommands/indexOfOutsideQuotes. |
| 16 | api/settings/telegram/route.ts | settings-telegram.test.ts | GET 200/500, PATCH 200/500, usePolling/stopPolling. |
| 17 | api/settings/telegram/test/route.ts | settings-telegram.test.ts | POST 400 no token, POST 200 ok false/true, fetch throw, non-Error throw. |
| 18 | api/settings/pricing/route.ts | settings-pricing.test.ts | All branches. |
| 19 | api/settings/pricing/[id]/route.ts | settings-pricing.test.ts | All branches. |
| 20 | api/settings/github/route.ts | settings-github.test.ts | All branches. |
| 21 | api/settings/github/test/route.ts | (settings-github or dedicated) | All branches. |

### B.4 Vault

| # | Route file | Test file | Notes |
|---|------------|-----------|--------|
| 22 | api/vault/create/route.ts | vault-create.test.ts | POST 400 missing/empty/non-string password, 400 already exists, 200 + Set-Cookie. |
| 23 | api/vault/unlock/route.ts | vault-create.test.ts | POST 400 no vault/non-string/missing, 401 wrong password/decrypt fail/wrong check, 200 + Set-Cookie. |
| 24 | api/vault/status/route.ts | vault-create.test.ts | GET branches. |
| 25 | api/vault/lock/route.ts | vault-create.test.ts | POST branches. |
| 26 | api/vault/credentials/route.ts | vault-credentials.test.ts | GET 403/200. |
| 27 | api/vault/credentials/[key]/route.ts | vault-credentials.test.ts | GET/PATCH/DELETE 403/200/404. |
| 28 | api/vault/credentials/clear/route.ts | vault-credentials.test.ts | POST 403/200. |
| 29 | api/vault/credentials/import/route.ts | vault-credentials.test.ts | 403, 400 content-type/no file/invalid JSON file, JSON body entries/keys, CSV paths, setStoredCredential throw. |

### B.5 Agents, skills, tasks, stats

| # | Route file | Test file | Notes |
|---|------------|-----------|--------|
| 30 | api/agents/route.ts | agents.test.ts | GET, POST (validation, duplicate), all branches. |
| 31 | api/agents/[id]/route.ts | agents.test.ts | GET 404/200, PUT, DELETE. |
| 32 | api/agents/[id]/execute/route.ts | agents.test.ts / runs-logs | All branches. |
| 33 | api/agents/[id]/refine/route.ts | agents.test.ts | POST 200/400/404; mock LLM if needed. |
| 34 | api/agents/[id]/skills/route.ts | agents.test.ts / skills.test.ts | GET, PUT, all branches. |
| 35 | api/agents/[id]/versions/route.ts | agents.test.ts | All branches. |
| 36 | api/agents/[id]/rollback/route.ts | agents.test.ts | All branches. |
| 37 | api/agents/[id]/workflow-usage/route.ts | agents.test.ts | All branches. |
| 38 | api/skills/route.ts | skills.test.ts | GET, POST, all branches. |
| 39 | api/skills/[id]/route.ts | skills.test.ts | GET 404/200 (config null/parsed), PUT 404/400/200 (body invalid JSON, config null/object), DELETE 404/200. |
| 40 | api/tasks/route.ts | tasks.test.ts | All branches. |
| 41 | api/tasks/[id]/route.ts | tasks.test.ts | All branches. |
| 42 | api/stats/agents/route.ts | stats.test.ts | All branches (null estimatedCost, etc.). |
| 43 | api/stats/agents/[id]/route.ts | stats.test.ts | GET 404/200, byDay/runs, null estimatedCost. |
| 44 | api/stats/workflows/route.ts | stats.test.ts | All branches. |
| 45 | api/stats/workflows/[id]/route.ts | stats.test.ts | GET 404/200, byAgent (unknown agent name), null estimatedCost, sort. |

### B.6 Chat (in-scope sub-routes only; main chat/route.ts excluded)

| # | Route file | Test file | Notes |
|---|------------|-----------|--------|
| 46 | api/chat/conversations/route.ts | chat-conversations.test.ts | GET, POST (title). |
| 47 | api/chat/conversations/[id]/route.ts | chat-conversations-id.test.ts | GET, PATCH, DELETE. |
| 48 | api/chat/events/route.ts | chat-events-sse.test.ts | All branches. |
| 49 | api/chat/pending-input/route.ts | chat-pending-input.test.ts | All branches. |
| 50 | api/chat/run-waiting/route.ts | chat-run-waiting.test.ts | All branches. |
| 51 | api/chat/settings/route.ts | chat-settings.test.ts | GET, PATCH. |

### B.7 RAG, files, tools, functions, feedback, notifications, etc.

| # | Route file | Test file | Notes |
|---|------------|-----------|--------|
| 52 | api/rag/collections/route.ts | (rag.test.ts or dedicated) | All branches. |
| 53 | api/rag/collections/[id]/route.ts | (rag.test.ts or dedicated) | All branches. |
| 54 | api/rag/connectors/route.ts | rag-connectors.test.ts | All branches. |
| 55 | api/rag/connectors/[id]/route.ts | rag-connectors.test.ts | GET/PATCH/DELETE 404/200. |
| 56 | api/rag/connectors/[id]/sync/route.ts | rag-connectors-sync.test.ts | All branches. |
| 57 | api/rag/document-store/route.ts | (rag-documents or store) | All branches. |
| 58 | api/rag/document-store/[id]/route.ts | All branches. |
| 59 | api/rag/documents/route.ts | rag-documents.test.ts | All branches. |
| 60 | api/rag/embedding-providers/route.ts | rag-embedding-providers.test.ts | All branches. |
| 61 | api/rag/embedding-providers/[id]/route.ts | All branches. |
| 62 | api/rag/embedding-providers/[id]/models/route.ts | All branches. |
| 63 | api/rag/encoding-config/route.ts | All branches. |
| 64 | api/rag/encoding-config/[id]/route.ts | All branches. |
| 65 | api/rag/ingest/route.ts | rag-ingest.test.ts | All branches. |
| 66 | api/rag/retrieve/route.ts | rag-retrieve.test.ts | All branches. |
| 67 | api/rag/upload/route.ts | rag-upload.test.ts | All branches. |
| 68 | api/rag/vector-store/route.ts | rag-vector-store.test.ts | All branches. |
| 69 | api/rag/vector-store/[id]/route.ts | All branches. |
| 70 | api/files/route.ts | files.test.ts | All branches. |
| 71 | api/files/[id]/route.ts | files-id.test.ts | All branches. |
| 72 | api/tools/route.ts | tools.test.ts | All branches. |
| 73 | api/tools/[id]/route.ts | All branches. |
| 74 | api/functions/route.ts | functions.test.ts | All branches. |
| 75 | api/functions/[id]/route.ts | (functions or functions-id) | GET/PATCH/DELETE. |
| 76 | api/functions/[id]/execute/route.ts | functions-execute.test.ts | All branches. |
| 77 | api/feedback/route.ts | feedback.test.ts | All branches. |
| 78 | api/feedback/[id]/route.ts | All branches. |
| 79 | api/feedback/for-scope/route.ts | feedback-for-scope.test.ts | All branches. |
| 80 | api/notifications/route.ts | notifications.test.ts | All branches. |
| 81 | api/notifications/clear/route.ts | notifications.test.ts | All branches. |
| 82 | api/import/route.ts | import.test.ts | All branches. |
| 83 | api/export/route.ts | export.test.ts | All branches. |
| 84 | api/backup/export/route.ts | backup.test.ts | All branches. |
| 85 | api/backup/restore/route.ts | backup.test.ts | All branches. |
| 86 | api/backup/reset/route.ts | backup.test.ts | All branches. |
| 87 | api/heap/route.ts | heap-route.test.ts | All branches. |
| 88 | api/llm/providers/route.ts | llm-providers.test.ts | All branches. |
| 89 | api/llm/providers/[id]/route.ts | llm-providers-id.test.ts | All branches. |
| 90 | api/llm/rate-limit-defaults/route.ts | llm-rate-limit-defaults.test.ts | All branches. |
| 91 | api/remote-servers/route.ts | remote-servers.test.ts | All branches. |
| 92 | api/remote-servers/[id]/route.ts | All branches. |
| 93 | api/reminders/route.ts | reminders.test.ts | All branches. |
| 94 | api/reminders/[id]/route.ts | reminders-id.test.ts | All branches. |
| 95 | api/queues/route.ts | queues.test.ts | All branches. |
| 96 | api/queues/message-log/route.ts | queues.test.ts | All branches. |
| 97 | api/rate-limit/queue/route.ts | rate-limit-queue.test.ts | All branches. |
| 98 | api/process-stats/route.ts | process-stats.test.ts | All branches. |
| 99 | api/system-stats/route.ts | system-stats.test.ts | All branches. |
| 100 | api/system-stats/history/route.ts | All branches. |
| 101 | api/update-check/route.ts | update-check.test.ts | All branches. |
| 102 | api/shell-command/execute/route.ts | shell-command-execute.test.ts | All branches. |
| 103 | api/telegram/webhook/route.ts | telegram-webhook.test.ts | All branches. |
| 104 | api/mcp/route.ts | mcp.test.ts | All branches. |

---

## Chat _lib (execute-tool, run-turn-helpers, etc.)

These live under `app/api/chat/_lib/`. They are covered indirectly by chat API and execute-tool tests. Work them as “one file at a time”:

| # | Source file | Test file | Definition of done |
|---|-------------|-----------|--------------------|
| 1 | execute-tool.ts | execute-tool.test.ts | All branches that are testable with mocks; document heavy LLM/runtime paths. |
| 2 | execute-tool-shared.ts | execute-tool.test.ts (and shared tests) | All branches. |
| 3 | execute-tool-handlers-workflows-runs-reminders.ts | execute-tool.test.ts | All branches. |
| 4 | run-turn-helpers.ts | run-turn-helpers.test.ts | All branches. |
| 5 | chat-route-shared.ts | (chat-api / execute-turn tests) | All branches. |
| 6 | chat-route-execute-turn.ts | chat-api.test.ts, execute-tool tests | All testable branches. |
| 7 | chat-route-heap.ts | heap-route.test.ts, chat-api.test.ts | All testable branches. |
| 8 | chat-route-post.ts | (excluded or integration) | If in scope: cover; else document. |

---

## Verification

- After finishing **each file**: run `npm run test:coverage` and open `packages/ui/coverage/index.html` → select that file and confirm 100% branches and full line/function coverage (or documented exclusions).
- After finishing **all** in-scope files: run `npm run test:coverage` and confirm:
  - Statements ≥ 70%
  - Branches = 100%
  - Functions ≥ 70%
  - Lines ≥ 70%

---

## Success criteria

- [ ] Every in-scope _lib file in Part A is finished (100% branches, full lines/functions for that file).
- [ ] Every in-scope route file in Part B (and chat _lib) is finished (100% branches, full lines/functions for that file).
- [ ] `npm run test:coverage` reports **≥70%** statements, lines, functions and **100%** branches.
- [ ] No new exclusions added solely to meet thresholds; gaps are documented where necessary.

---

## Reference

- Config: `packages/ui/vitest.config.ts`
- Test layout: `packages/ui/__tests__/README.md`
- Rules: `.cursor/rules/coverage-and-test-failures.mdc`, `.cursor/rules/bug-fix-add-tests.mdc`
