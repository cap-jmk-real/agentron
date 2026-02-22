# Coverage Execution Plan: Achieve 70% / 100% Thresholds

## 1. Coverage criteria (vitest.config.ts)

| Metric     | Target | Baseline | Current (Batch T+U done)     |
|------------|--------|----------|-----------------------------|
| Statements | ≥ 70%  | 61.61%   | ~62.5%                      |
| Branches   | **100%** | 47.88% | ~49.9%                      |
| Functions  | ≥ 70%  | 69.17%   | ~69.8%                      |
| Lines      | ≥ 70%  | 62.94%   | ~63.4%                      |

Improve **only by adding tests**. No new exclusions. Finish one file at a time (100% branches, full line/function for that file).

---

## 2. How to work systematically

**Per-file cycle (repeat until thresholds met):**

1. Run from repo root: `npm run test:coverage --workspace=packages/ui`
2. Open `packages/ui/coverage/index.html` in a browser
3. In the report, open the **next file** from the list below (or pick any in-scope file with red/yellow branches)
4. Add or extend tests in the **test file** for that source until the file shows **100% branches** and full line/function coverage (or document exclusions)
5. Run `npm test --workspace=packages/ui` (or `npx vitest run <test-file>`); fix failures
6. Re-run coverage; confirm the file is green, then move to the next file

**How to find gaps:** In `coverage/index.html`, click a file. Red/yellow branches and red lines are uncovered. Add tests that hit those branches/lines.

---

## 3. Part A: _lib files (ordered for execution)

Finish in this order. Test path: `packages/ui/__tests__/api/_lib/<name>.test.ts` unless noted.

| Done | Source file | Test file / notes |
|------|-------------|-------------------|
| ✓ | response.ts | response.test.ts |
| ✓ | store.ts | store.test.ts |
| ✓ | api-logger.ts | api-logger.test.ts |
| ✓ | rag-limits.ts | rag-limits.test.ts |
| ✓ | execution-log.ts | execution-log.test.ts |
| ✓ | feedback-retrieval.ts | feedback-retrieval.test.ts |
| ✓ | telegram-sessions.ts | telegram-sessions.test.ts |
| ✓ | chat-event-channel.ts | chat-event-channel.test.ts |
| ✓ | credential-store.ts | credential-store.test.ts |
| ✓ | vault.ts | vault.test.ts |
| ✓ | app-settings.ts | app-settings.test.ts |
| ✓ | workflow-queue.ts | workflow-queue.test.ts |
| ✓ | db-mappers.ts | db-mappers.test.ts |
| ✓ | notifications-store.ts | notifications.test.ts (route) |
| ✓ | execution-events.ts | execution-events.test.ts |
| ✓ | shell-exec.ts | shell-exec.test.ts |
| ✓ | scheduled-workflows.ts | scheduled-workflows.test.ts |
| ✓ | vector-store-query.ts | vector-store-query.test.ts |
| ✓ | run-workflow-tool-execution.ts | run-workflow-tool-execution.test.ts (std-web-search) |
| ✓ | github-api.ts | github-api.test.ts |
| ✓ | github-settings.ts | github-settings.test.ts |
| ✓ | github-reported-runs.ts | github-reported-runs.test.ts |
| ✓ | run-scheduled-workflow.ts | run-scheduled-workflow.test.ts |
| ✓ | run-workflow-constants.ts | run-workflow-constants.test.ts |
| ✓ | container-manager.ts | container-manager.test.ts (pure fns) |
| ✓ | specialist-overrides.ts | specialist-overrides.test.ts |
| ✓ | run-failure-side-effects.ts | run-failure-side-effects.test.ts (early-return branches) |
| ✓ | reminder-scheduler.ts | reminder-scheduler.test.ts |
| ✓ | feedback-for-scope.ts | feedback-for-scope.test.ts (_lib + route) |
| ✓ | chat-queue.ts | chat-queue.test.ts (stale lock branch) |
| ✓ | embeddings.ts | embeddings.test.ts |
| ✓ | rag.ts | rag.test.ts (_lib) |
| ✓ | execute-tool-shared.ts | chat/_lib/execute-tool-shared.test.ts (resolveWorkflowIdFromArgs) |
| ✓ | rag-extract.ts | rag-extract.test.ts |
| ✓ | telegram-settings.ts | telegram-settings.test.ts + settings-telegram.test.ts |
| ✓ | chat-helpers.ts | chat-helpers.test.ts (extractOptionsFromContentWithLLM branches) |
| → | **Next** | **Pick from coverage report: low branch % _lib file** |
|   | db.ts | Route tests; no standalone _lib test (db used everywhere) |
|   | system-stats.ts | system-stats.test.ts (collectSystemStats, pushHistory, getHistory done) |

**Part A remaining (tackle in any order):** db.ts (via routes only), system-stats.ts. All other _lib files above are marked done; re-check coverage/index.html for any that still show red branches and add tests.

---

## 4. Part B: Route files (checklist)

Test file = `__tests__/api/<area>.test.ts` or as noted. Open each route in coverage/index.html and add tests until 100% branches.

**Runs:** runs-logs.test.ts, runs-for-improvement.test.ts  
- [ ] api/runs/route.ts (GET limit/targetType/targetId, workflowIds/agentIds enrichment)  
- [ ] api/runs/[id]/route.ts (GET 404/200, PATCH body branches, createRunNotification/ensureRunFailureSideEffects)  
- [ ] api/runs/[id]/trace/route.ts, agent-request, events, messages  
- [ ] api/runs/[id]/for-improvement/route.ts  
- [ ] api/runs/pending-help/route.ts  

**Workflows:** workflows.test.ts, workflow-queue-route.test.ts  
- [ ] api/workflows/route.ts, [id]/route.ts, [id]/execute, [id]/rollback, [id]/versions  
- [ ] api/workflow-queue/route.ts  

**Settings:** settings-app.test.ts, settings-telegram.test.ts, settings-pricing.test.ts, settings-github.test.ts  
- [ ] api/settings/app/route.ts (GET/PATCH all branches, splitShellCommands)  
- [ ] api/settings/telegram/route.ts, telegram/test/route.ts  
- [ ] api/settings/pricing/route.ts, pricing/[id]/route.ts  
- [ ] api/settings/github/route.ts, github/test/route.ts  

**Vault:** vault-create.test.ts, vault-credentials.test.ts  
- [ ] api/vault/create, unlock, status, lock  
- [ ] api/vault/credentials/route.ts, [key], clear, import  

**Agents, skills, tasks, stats:** agents.test.ts, skills.test.ts, tasks.test.ts, stats.test.ts  
- [ ] api/agents/route.ts, [id], [id]/execute, refine, skills, versions, rollback, workflow-usage  
- [ ] api/skills/route.ts, [id]  
- [ ] api/tasks/route.ts, [id]  
- [ ] api/stats/agents, agents/[id], workflows, workflows/[id]  

**Chat (in-scope only):** chat-conversations.test.ts, chat-conversations-id.test.ts, chat-events-sse.test.ts, chat-pending-input.test.ts, chat-run-waiting.test.ts, chat-settings.test.ts  
- [ ] api/chat/conversations, conversations/[id]  
- [ ] api/chat/events, pending-input, run-waiting, settings  

**RAG, files, tools, feedback, notifications, etc.:** See main plan Part B (rag.test.ts, rag-*.test.ts, files.test.ts, files-id.test.ts, tools.test.ts, feedback.test.ts, feedback-for-scope.test.ts, notifications.test.ts, import.test.ts, export.test.ts, backup.test.ts, heap-route.test.ts, llm-providers, remote-servers, reminders, queues, rate-limit-queue, process-stats, system-stats, update-check, shell-command/execute, telegram/webhook, mcp.test.ts).

---

## 5. Chat _lib (app/api/chat/_lib/)

| Source file | Test file | Status |
|-------------|-----------|--------|
| execute-tool-shared.ts | chat/_lib/execute-tool-shared.test.ts | Done (resolveWorkflowIdFromArgs) |
| run-turn-helpers.ts | chat/_lib/run-turn-helpers.test.ts | Done (buildRunResponseForChat, shouldSkipRephrase, etc.) |
| execute-tool.ts | execute-tool.test.ts | Add tests for uncovered branches |
| execute-tool-handlers-workflows-runs-reminders.ts | execute-tool.test.ts | Via handler tests |
| chat-route-shared.ts | chat-api.test.ts, execute-turn tests | Add as needed |
| chat-route-execute-turn.ts | chat-api.test.ts | Add as needed |
| chat-route-heap.ts | heap-route.test.ts, chat-api.test.ts | Add as needed |

**Chat _lib order:** Open each file in coverage/index.html; add tests in the corresponding test file until 100% branches.

---

## 6. Batch execution checklist

Work in **big batches**: each batch = 3–6 files from the list below. After each batch: run `npm run test:coverage --workspace=packages/ui`, open `coverage/index.html`, confirm targeted files improved, then start the next batch.

**Batch A — Routes (runs, settings, notifications, skills):**

- [x] api/runs/route.ts — runs-logs.test.ts (GET targetType/targetId/limit, enrichment)
- [x] api/runs/[id]/route.ts — runs-logs.test.ts (GET 404/200, PATCH all branches, finishedAt, output null)
- [x] api/settings/app/route.ts — settings-app.test.ts (GET 500 non-Error, PATCH branches, addShellCommand)
- [x] api/notifications/route.ts — notifications.test.ts (GET limit/offset, enrichment)
- [x] api/skills/[id]/route.ts — skills.test.ts (PUT no updatable fields, GET config null, PUT 400 invalid JSON)

**Batch B — Workflows + stats:**

- [x] api/workflows/[id]/execute/route.ts — workflows.test.ts (negative maxSelfFixRetries clamp)
- [x] api/workflows/[id]/rollback/route.ts — workflows.test.ts (version as non-number → 404)
- [x] api/stats/agents/[id]/route.ts — stats.test.ts (404, empty timeSeries/runs when no token usage)
- [x] api/stats/workflows/[id]/route.ts — stats.test.ts (404, empty agents when no token usage)

**Batch C — Agents, tasks, vault:**

- [x] api/agents/[id]/route.ts — agents.test.ts (PUT with no definition)
- [x] api/agents/route.ts — agents.test.ts (POST with payload.id, POST with name missing/empty → randomAgentName)
- [x] api/tasks/route.ts — tasks.test.ts (GET ?status=approved empty, POST with optional id)
- [x] api/tasks/[id]/route.ts — tasks.test.ts (PATCH approve without output, default resolvedBy)
- [x] api/vault/* — vault-create.test.ts (status vaultExists false/locked, status locked false with cookie, create invalid JSON), vault-credentials.test.ts

**Batch D — Chat _lib and chat routes:**

- [x] app/api/chat/_lib/execute-tool.ts — execute-tool.test.ts (retry_last_message no context, format_response, get_tool not found, create_tool empty name, list_tools no category)
- [ ] app/api/chat/_lib/chat-route-*.ts — chat-api.test.ts, heap-route.test.ts
- [x] api/chat/run-waiting/route.ts — chat-run-waiting.test.ts (message fallback, invalid JSON output)
- [x] api/chat/pending-input/route.ts — chat-pending-input.test.ts (ask_credentials, ask_user options, null/invalid toolCalls, format_response formatted false)
- [x] api/chat/conversations/route.ts — chat-conversations.test.ts (invalid JSON, whitespace title)
- [x] api/chat/conversations/[id]/route.ts — chat-conversations-id.test.ts (PATCH empty body, rating/note null, PATCH/DELETE 404)
- [x] api/chat/events/route.ts — chat-events-sse.test.ts (empty/whitespace turnId 400)
- [x] api/chat/settings/route.ts — chat-settings.test.ts (customSystemPrompt null/empty)

**Batch E — Remaining Part B routes:**

- [x] api/process-stats/route.ts — process-stats.test.ts (memory.external asserted)
- [x] api/feedback/route.ts — feedback.test.ts (GET executionId empty, POST with id)
- [x] api/tools/route.ts — tools.test.ts (POST with optional id)
- [x] api/tools/[id]/route.ts — tools.test.ts (PUT empty body for std tool keeps existing schemas)
- [x] api/reminders/route.ts — reminders.test.ts (message whitespace-only 400)
- [x] api/backup/reset/route.ts — backup.test.ts (reset 500 when throw, 500 when non-Error)
- [x] api/queues/route.ts — queues.test.ts (activeChatTraces when toolCalls/llmTrace not array)
- [x] api/import/route.ts — import.test.ts (nailed: workflow skip/update, tool no config, workflow schedule/description/default executionMode, non-array capabilities/scopes; 100% stmt/lines, ~95% branches)
- [x] api/llm/providers/route.ts — llm-providers.test.ts (nailed: GET 500 db throw + non-Error, POST rateLimit/contextLength number/zero/extra array, POST invalid JSON, logApiError throw inner catch; 100% stmt/lines, ~92% branches)
- [x] api/settings/telegram/test/route.ts — settings-telegram.test.ts (nailed: 100% branches, 100% lines; error branch res.statusText + "Telegram API error" fallback)
- [x] api/vault/credentials/import/route.ts — vault-credentials.test.ts (nailed: csv form field, label/username/service headers, empty file, skips empty key; ~87% branches, 100% lines)
- [x] api/update-check/route.ts — update-check.test.ts (npm_package_version fallback when AGENTRON_APP_VERSION unset)
- [x] api/remote-servers/route.ts — remote-servers.test.ts (nailed: 100% branches; POST with custom port)
- [x] api/telegram/webhook/route.ts — telegram-webhook.test.ts (nailed: 100% branches; POST with secret matching)
- [x] api/rag/retrieve/route.ts — rag-retrieve.test.ts (non-string query as empty)
- [x] api/rag/vector-store/route.ts and [id] — rag-vector-store.test.ts (POST with id and without config, PUT invalid JSON, PUT config)
- [x] api/rag/upload/route.ts — rag-upload.test.ts (502 when putObject throws non-Error)
- [x] RAG other, files, heap, system-stats, shell-command/execute, mcp — rag-connectors (GET lastError string/non-string, POST with id), rag.test (document-store [id] GET/PUT/DELETE 404, PUT 400 invalid JSON, PUT empty body, GET with null region/endpoint/credentialsRef), rag-vector-store (GET list with config null), files/heap/system-stats/mcp/shell-command already 100%

**How to use:** Pick the next unchecked item(s) in Batch B/C/D/E. Open that source file in `coverage/index.html`, add tests for red/yellow branches, run tests and coverage, then check off and move on.

**Batch F — Routes nailed this cycle:**

- [x] api/rag/document-store/[id]/route.ts — rag.test.ts (PUT region only, endpoint only, credentialsRef only; GET/PUT/DELETE 404, PUT 400, PUT empty body, GET null region/endpoint/credentialsRef already in place)
- [x] api/runs/[id]/route.ts — runs-logs.test.ts (GET agent targetName, PATCH 404 for unknown id)

**Batch G — Routes nailed this cycle:**

- [x] api/runs/route.ts — runs-logs.test.ts (GET with limit=1, GET with targetType=other&targetId so workflowIds/agentIds empty and name lookups skipped)
- [x] api/rag/retrieve/route.ts — rag-retrieve.test.ts (POST with collectionId and no limit uses collection scope for effective limit)

**Batch H — Routes nailed this cycle:**

- [x] api/rag/encoding-config/[id]/route.ts — rag.test.ts (GET embeddingProviderId/endpoint undefined when null, PUT 400 invalid JSON, PUT empty body)
- [x] api/rag/collections/[id]/route.ts — rag.test.ts (GET 404, GET agentId/vectorStoreId undefined when null, PUT 404, PUT 400 invalid JSON, PUT empty body, DELETE 404)
- [x] api/home/route.ts — home.test.ts (GET shape; GET with pending tasks populates agents and workflowsMap)

**Batch I — Routes nailed this cycle:**

- [x] api/runs/[id]/respond/route.ts — runs-respond.test.ts (404, 400 when run not waiting_for_user, 400 invalid JSON, 200 with response, empty response → "(no text)", long response → replyPreview truncation in log)
- [x] api/rag/document-store/route.ts — rag.test.ts (POST 400 for invalid JSON)

**Batch J — Routes nailed this cycle:**

- [x] api/runs/[id]/trace/route.ts — runs-logs.test.ts (GET returns undefined targetName when workflow was deleted / orphan run)
- [x] api/runs/pending-help/route.ts — runs-logs.test.ts (GET caps suggestions at 20)
- [x] api/stats/workflows/[id]/route.ts — stats.test.ts (GET returns Unknown for token row with null agentId)

**Batch K — Routes nailed this cycle:**

- [x] api/runs/[id]/route.ts — runs-logs.test.ts (GET returns targetName undefined for run with targetType other)
- [x] api/rag/document-store/[id]/route.ts — rag.test.ts (PUT updates type only, PUT updates name only)

**Batch L — Routes nailed this cycle:**

- [x] api/runs/[id]/trace/route.ts — runs-logs.test.ts (GET returns undefined targetName when agent was deleted)
- [x] api/stats/agents/[id]/route.ts — stats.test.ts (GET returns timeSeries with count 2 when two token rows on same day)

**Batch M — Routes nailed this cycle:**

- [x] api/rag/upload/route.ts — rag-upload.test.ts (POST second upload to same collection uses existing upload dir; ensureRagUploadsDir exists branch)
- [x] api/vault/credentials/import/route.ts — vault-credentials.test.ts (POST form field "csv", CSV header "label"/"label,value"; isHeader branches)
- [ ] api/runs/route.ts lines 30,37 — defensive `w.name ?? ""` / `a.name ?? ""` unreachable (workflows.name NOT NULL); no test added

**Batch N — Routes nailed this cycle:**

- [x] api/stats/workflows/[id]/route.ts — stats.test.ts (GET returns agent name Unknown when token row has agentId null; byAgent aid not in agentMap)
- [x] api/skills/[id]/route.ts — skills.test.ts (PUT with only name preserves existing config; body.config undefined branch)
- [x] api/workflows/[id]/execute/route.ts — workflows.test.ts (POST uses default maxSelfFixRetries when body has non-number)

**Batch O — Routes nailed this cycle:**

- [x] api/runs/pending-help/route.ts — runs-logs.test.ts (GET uses targetId as targetName when workflow name is empty; targetName \|\| r.targetId)
- [x] api/runs/[id]/trace/route.ts — runs-logs.test.ts (GET returns empty trail when output.trail is not an array)
- [x] api/settings/app/route.ts — settings-app.test.ts (PATCH accepts whitespace-only braveSearchApiKey/googleCseKey; trim to undefined branch)

**Batch P — Routes nailed this cycle:**

- [x] api/runs/[id]/agent-request/route.ts — runs-logs.test.ts (GET returns empty when output is JSON null; GET uses out.options when inner has no suggestions or options)
- [x] api/vault/credentials/import/route.ts — vault-credentials.test.ts (POST skips CSV row with empty key cell; parseCsv key && value branch)
- [x] api/settings/app/route.ts — settings-app.test.ts (PATCH addShellCommand with whitespace-only adds nothing; splitShellCommands branch)

**Batch Q — Routes nailed this cycle:**

- [x] api/runs/pending-help/route.ts — runs-logs.test.ts (GET uses default question when run has no output; GET uses default question when run output is empty object; if (r.output) skip branch and empty out branch)

**Batch R — Routes nailed this cycle:**

- [x] api/vault/credentials/import/route.ts — vault-credentials.test.ts (POST multipart JSON file with no entries or keys array; else-if branches)
- [x] api/stats/workflows/[id]/route.ts — stats.test.ts (GET returns agent name Unknown when token row has agentId not in agents table; agentMap.get(aid) undefined for non-null id)
- [x] system-stats.test.ts — getCachedSystemStats test stabilized (prime cache before asserting same snapshot)

**Batch S — Routes nailed this cycle:**

- [x] api/runs/pending-help/route.ts — runs-logs.test.ts (GET uses output.reason when present and no message; reason ternary first branch)
- [x] api/rag/document-store/[id]/route.ts — rag.test.ts (PUT updates bucket only)

**Batch T — Routes nailed this cycle:**

- [x] api/vault/unlock/route.ts — vault-create.test.ts (POST with invalid JSON body so catch runs)
- [x] api/vault/credentials/import/route.ts — vault-credentials.test.ts (POST skips CSV row with only one column; parseCsv row.length < 2)
- [x] api/runs/[id]/trace/route.ts — runs-logs.test.ts (GET returns targetName for agent run when agent exists)

**Batch U — Routes nailed this cycle:**

- [x] api/runs/pending-help/route.ts — runs-logs.test.ts (GET keeps default question when output.question is whitespace-only; question trim branch)

**Batch V — Routes and stability this cycle:**

- [x] system-stats.test.ts — getCachedSystemStats test stabilized with vi.useFakeTimers() so cache TTL does not expire between calls
- [x] api/runs/pending-help/route.ts — runs-logs.test.ts (GET leaves suggestions undefined when output.suggestions is not an array; Array.isArray branch)

**Batch W — Routes nailed this cycle:**

- [x] api/workflows/[id]/execute/route.ts — workflows.test.ts (POST floors maxSelfFixRetries when float; Math.floor branch)

**Batch X — Routes nailed this cycle:**

- [x] api/runs/pending-help/route.ts — runs-logs.test.ts (GET returns empty suggestions array when output.suggestions is []; Array.isArray branch with empty result)
- [x] api/settings/github/test/route.ts — settings-github.test.ts (POST uses "GitHub API error" when not ok and errBody has no message and statusText empty)

**Batch Y — Routes nailed this cycle:**

- [x] api/settings/telegram/route.ts — settings-telegram.test.ts (PATCH ignores notificationChatId when not a string, so false branch of typeof === "string")
- [x] api/vault/credentials/import/route.ts — vault-credentials.test.ts (POST parses CSV with quoted field containing comma; parseCsv quoted-cell path)

**Batch Z — Routes and branches this cycle:**

- [x] api/vault/credentials/import — vault-credentials.test.ts (CSV with username header; multipart JSON file with .json and entries array)
- [x] api/runs/pending-help — runs-logs.test.ts (GET with both workflow and agent runs in list so workflowIds and agentIds lookups both run; targetName for workflow)

**Batch AA — Routes and branches this cycle:**

- [x] api/workflows/[id]/execute/route.ts — workflows.test.ts (POST returns 200 when WaitingForUserError trail update throws; inner catch “ignore” branch)
- [x] api/runs/[id]/trace/route.ts — runs-logs.test.ts (GET returns undefined targetName for run with targetType other; neither workflow nor agent branch)

**Batch AB — Routes and branches this cycle:**

- [x] api/vault/credentials/import — vault-credentials.test.ts (POST skips CSV row with empty value cell in parseCsv; key && value false branch)
- [x] api/runs/route.ts — runs-logs.test.ts (GET with limit=0 uses default 50; GET with targetId matching no runs skips workflow and agent enrichment)

**Batch AC — Routes and branches this cycle:**

- [x] api/runs/pending-help — runs-logs.test.ts (GET uses output.message when reason is whitespace-only; reason ternary message branch)
- [x] api/runs/route.ts — runs-logs.test.ts (GET with limit=300 caps at 200; Math.min branch)
- [x] api/settings/telegram/test — settings-telegram.test.ts (POST with body.token non-string uses getTelegramBotToken else branch)

**Batch AD — Routes and branches this cycle:**

- [x] api/vault/credentials/import — vault-credentials.test.ts (POST skips CSV row with empty key cell in parseCsv; key && value false branch)
- [x] api/home — home.test.ts (GET includes workflow with null estimatedCost in cost reduce)

**Batch AE — Routes and branches this cycle:**

- [x] api/workflows/[id]/execute — workflows.test.ts (POST merges trail into existing output when run output is string; mock db.select returns output string, hits parse branch 81-82)
- [x] api/settings/telegram — settings-telegram.test.ts (PATCH updates botTokenEnvVar; branch 34)

**Batch AF — Routes and branches this cycle:**

- [x] api/workflows/[id]/execute — workflows.test.ts (POST merges trail when run output is object; mock db.select returns output as object, hits branch 83 raw-as-Record)

**Batch AG — Routes and branches this cycle:**

- [x] api/workflows/[id]/execute — workflows.test.ts (POST uses default when body.maxSelfFixRetries is number NaN; fake request with json() returning { maxSelfFixRetries: Number.NaN }, hits branch 32 !Number.isNaN(v) false)
- [x] api/workflows/[id]/rollback — workflows.test.ts (POST treats invalid JSON body as empty and returns 404; request.json().catch(() => ({})) and versionId/version missing path; rollback now 100% branches/functions)

**Batch AH — Routes and branches this cycle:**

- [x] api/vault/credentials/import — vault-credentials.test.ts (POST treats file with unknown extension as CSV content; File with name "data.unknown" hits else branch at 90)

**Batch AI — Reminders and run-code this cycle:**

- [x] api/reminders/route.ts — reminders.test.ts (POST returns 400 when inMinutes is 0; POST returns 400 when inMinutes is negative; else branch "Either at or inMinutes is required")
- [x] api/run-code/route.ts — run-code.test.ts (POST returns 400 for invalid JSON body; POST returns 400 when code missing/empty/whitespace-only; request.json() catch and !code.trim() paths). Unused imports removed from run-code.test.ts.

**Batch AJ — Settings-app Unix and setup status this cycle:**

- [x] api/settings/app/route.ts — settings-app-unix.test.ts (PATCH addShellCommand splits on semicolon when platform is Unix; vi.mock("node:os", () => ({ platform: () => "linux" })) so splitShellCommands uses ["&&", "||", ";"])
- [x] api/setup/status/route.ts — setup-status.test.ts (GET returns vaultExists and hasLlmProvider)

**Batch AK — Runs [id] and vault import this cycle:**

- [x] api/runs/[id]/route.ts — runs-logs.test.ts (PATCH returns 200 when ensureRunFailureSideEffects throws; mock run-failure-side-effects and status failed to hit catch branch)
- [x] api/vault/credentials/import/route.ts — vault-credentials.test.ts (POST parses CSV with label,caption header; POST parses CSV with username,login header; label-only and username-only isHeader branches)

**Suggested next:** Vault/credentials/import remaining branches 66,68-69,81 (parseCsv defensive row[0]/row[row.length-1] ?? "" may be unreachable). Add tests in big batches for other low-coverage files → run coverage → update plan.

---

## 7. Verification

- **Per file:** In `coverage/index.html`, target file shows 100% branches and no uncovered lines/functions (or documented exclusions).
- **Final:** `npm run test:coverage --workspace=packages/ui` reports:
  - Statements ≥ 70%
  - Branches = 100%
  - Functions ≥ 70%
  - Lines ≥ 70%

---

## 8. Reference

- Main plan: `.cursor/plans/coverage-above-70-percent.md`
- Config: `packages/ui/vitest.config.ts`
- Rules: `.cursor/rules/coverage-and-test-failures.mdc`, `bug-fix-add-tests.mdc`
