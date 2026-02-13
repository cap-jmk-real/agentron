# Task delegation, cron workflows, and Telegram integration — research

This document summarizes how Agentron can be improved so users **delegate tasks** to Agentron, which **creates agents and workflows** (possibly many) to achieve them, **asks the user for help** when needed, and supports **scheduled execution** and **remote interaction** (e.g. Telegram). The user can interact **either via the in-app chat or via Telegram** when the bot is configured—same capabilities, different entry point.

---

## 1. Current state

### 1.1 Task delegation via chat

- **Chat assistant** already creates/edits agents and workflows via tools (`create_agent`, `create_workflow`, `update_workflow`, `execute_workflow`, etc.) and can run workflows from natural language.
- **User-in-the-loop** is supported in two places:
  - **Chat:** `ask_user` tool — assistant asks a clear question; same response must not include create/update/execute; user replies in the next message.
  - **Workflow runs:** `request_user_help` tool — during a workflow run, an agent can call this tool; the run is marked `waiting_for_user`, and the question is stored in the run’s `output`. The user sees “Agent needs your input” in the chat (pending-help cards) and on the run detail page.

### 1.2 Pending help and “respond”

- **`GET /api/runs/pending-help`** returns runs with `status === "waiting_for_user"` and their question/reason.
- **`POST /api/runs/:id/respond`** accepts `{ response: string }` and **marks the run as completed** with that response as the final output. The run does **not** resume; it ends. So today, “respond” is “close the run with the user’s answer,” not “resume the workflow with this input.”

### 1.3 Workflow execution modes and scheduling

- **Types:** `ExecutionMode = "one_time" | "continuous" | "interval"` and `Workflow.schedule?: string` exist in `packages/core` and DB.
- **UI:** Workflow detail page lets users set mode and schedule (interval presets, custom interval, daily@time, weekly@days).
- **Runtime:** `packages/runtime/src/workflow/scheduler.ts` defines `WorkflowScheduler` with `scheduleInterval(workflow, intervalMs, run)` and `clear`/`clearAll`, but **this scheduler is never used** anywhere in the repo. So **interval/continuous workflows are not actually executed on a schedule**; only one-off `POST /api/workflows/:id/execute` runs them.

---

## 2. Improvements

### 2.1 Task delegation (conceptual model)

- Keep the current flow: user describes a task in chat → assistant plans, creates agents/workflows, runs them, and uses `ask_user` when it needs a choice or confirmation.
- Optional enhancements:
  - **First-class “task” entity:** A task could be a record (e.g. “Summarize these docs”, “Run report daily”) that points to one or more workflows and optional schedule. The chat could create a task and attach workflows to it; the UI could show “Tasks” and their status.
  - **Multi-workflow orchestration:** The assistant already can create and run multiple workflows in one conversation. Making this explicit (e.g. “I’ll create 2 workflows for this; run both?”) and surfacing progress per workflow improves clarity.

No change to the core delegation flow is strictly required; the main gaps are **scheduling** and **remote interaction**.

### 2.2 User-in-the-loop improvements

- **Notify when help is needed:** When a run goes to `waiting_for_user`, optionally notify the user (in-app badge is already there; add optional push/Telegram/email so they can respond remotely).
- **True “resume” (optional, larger change):** Today, responding to a run completes it. To allow the workflow to continue after the user’s reply, you’d need either:
  - A **new run** that receives the user response as input and continues from a saved checkpoint (requires persisting workflow state and a “resume from run X with input Y” API), or
  - **Long-lived runs** that pause and resume in the same process (harder with HTTP and serverless; easier with a persistent worker and a queue).

For many use cases, “run ends with user response” is enough; the assistant can start a new workflow or run with that response in the next turn.

### 2.3 Task queue (multiple concurrent requests)

When the user (or several users, or Telegram + web UI) sends **multiple requests** at once, you need a **task queue** so that:

- **Heavy work is bounded:** Chat turns and workflow runs use LLMs, tools, and I/O; running many in parallel can exhaust memory, CPU, or rate limits.
- **Ordering is predictable:** Per conversation, message 2 should wait for message 1 to finish so the assistant has correct context. For workflow runs, you may want FIFO or priority.
- **Nothing is dropped:** Requests are accepted immediately and processed when capacity is free; scheduled workflow runs enqueue a job instead of blocking the scheduler.

**What to queue:**

| Source | Job type | Queuing need |
|--------|----------|---------------|
| **Chat** (web or Telegram) | One assistant turn (LLM + tool calls, possibly `execute_workflow`) | Serialize per conversation so turns don't interleave; optionally limit global concurrency |
| **Workflow execute** (UI, API, Telegram) | Single workflow run | Limit concurrent runs; optional per-workflow "don't start same workflow again if previous run still running" |
| **Scheduler** (cron/interval) | Scheduled workflow run | Enqueue a run job instead of calling `runWorkflow()` directly; same queue as ad-hoc runs |

**Options:**

- **Lightweight (no Redis):**
  - **Per-conversation lock:** In-memory map `conversationId -> promise`; each new message for that conversation waits for the previous promise to settle, then runs. New conversations run in parallel up to a simple cap (e.g. semaphore with max N concurrent chat handlers).
  - **Workflow run queue:** In-memory queue (e.g. p-queue) with concurrency 1–2; both API-triggered and scheduler-triggered runs go through it. On restart, in-flight work is lost; scheduled runs will fire again on next tick.
- **Robust (with Redis + BullMQ):**
  - **Chat queue:** One queue (or per-conversation queues); workers process "chat turn" jobs. Conversation order is preserved by using the same queue and job data that includes `conversationId` (or by a per-conversation queue).
  - **Workflow queue:** One queue for "run workflow" jobs; workers call `runWorkflow()`. Scheduler and API both add jobs. You get retries, persistence, and visibility.
  - Optionally **one queue** for "tasks" with a `type: 'chat' | 'workflow'` and a worker pool that handles both, or separate queues and workers for chat vs workflow.

**Recommendation:**

- **Minimum:** Serialize chat per conversation (so multiple quick messages are processed one after another) and cap concurrent workflow runs (e.g. in-memory queue with concurrency 2). Scheduler should enqueue a "run workflow" task instead of executing inline so that if a run is slow or waiting for user, the next scheduled tick doesn't stack.
- **Better:** Introduce a single job queue (e.g. BullMQ) for both "chat turn" and "workflow run" jobs. All entry points (HTTP chat, Telegram, scheduler, `POST /api/workflows/:id/execute`) push a job; one or more workers process them. That gives you a single place to enforce concurrency, retries, and observability.

---

## 3. Cron / scheduled execution for workflows

### 3.1 Goal

- Workflows with `executionMode === "interval"` or `"continuous"` and a `schedule` should run automatically.
- Support:
  - **Interval:** every N seconds (e.g. `schedule = "300"` = every 5 minutes).
  - **Calendar-style:** already in UI as `daily@09:00`, `weekly@1,3,5` (days 0–6). These need cron-like or next-run computation.

### 3.2 Option A: In-process scheduler (simplest)

- **Where:** Same Node process as the Studio (e.g. in `packages/ui` or a small `packages/scheduler` that the server loads).
- **On startup (and when workflows change):**
  - Load all workflows with `executionMode === "interval"` or `"continuous"`.
  - For **interval:** parse `schedule` as seconds; use `setInterval` (or the existing `WorkflowScheduler.scheduleInterval`) to call `POST /api/workflows/:id/execute` (or the same `runWorkflow` used by the API) at that interval.
  - For **calendar:** parse `daily@HH:mm` / `weekly@d1,d2,...` and use a **cron parser** (e.g. `cron-parser`) or a simple “next run at” calculator and `setTimeout`/reschedule after each run.
- **Libraries:** `cron-parser` for cron expressions if you add standard cron (e.g. `0 9 * * 1-5`); for the current string format, a small parser for `daily@` / `weekly@` is enough.
- **Persistence:** Schedule state lives only in memory; restart clears it. Re-load workflows on startup and when a workflow is created/updated/deleted.

**Pros:** Minimal new infra, reuses existing `WorkflowScheduler` and execution path.  
**Cons:** No persistence of schedule state across restarts; single process.

### 3.3 Option B: Job queue (BullMQ + Redis)

- Use **BullMQ** (or similar) with a **repeatable job** per workflow:
  - **Interval:** repeat every N seconds via BullMQ’s repeat options.
  - **Cron:** use a cron pattern (e.g. `0 9 * * 1-5`) with BullMQ’s cron repeat strategy.
- Worker process(es) consume jobs and call the same workflow execution logic (e.g. HTTP to Studio or direct import of `runWorkflow`).
- **Pros:** Persisted schedule, retries, scaling, visibility.  
**Cons:** Requires Redis and a separate worker (or same app as worker).

### 3.4 Recommendation

- **Short term:** Option A — wire the existing `WorkflowScheduler` (or a small scheduler module) into the Studio process: on app start and on workflow create/update/delete, register interval/calendar runs that invoke the existing workflow execution. Parse the existing `schedule` format (`seconds`, `daily@HH:mm`, `weekly@d1,d2,...`); optionally add cron later.
- **Later:** If you need durability and scale, introduce BullMQ (or similar) and move scheduled workflow execution into a queue worker.

### 3.5 Implementation sketch (Option A)

1. **Scheduler service** (e.g. in `packages/ui` or `packages/runtime`):
   - Load workflows where `executionMode in ('interval','continuous')` and `schedule` is set.
   - For each: compute interval ms or next run time (from `daily@` / `weekly@`).
   - Use `WorkflowScheduler.scheduleInterval` for interval; for calendar, use `setTimeout` until next run, then execute and re-schedule.
2. **Execution:** Call the same `runWorkflow()` used by `POST /api/workflows/:id/execute` (or an internal function that enqueues execution) so behavior and `request_user_help` are unchanged.
3. **Hooks:** On workflow create/update/delete, update the scheduler (register/clear/reschedule).
4. **Startup:** When the Next.js server (or Electron main process) starts, run the “load and schedule” step once.

---

## 4. Telegram integration (remote interaction)

### 4.1 Goal

- **Dual entry points:** The user interacts with Agentron either via the **in-app chat** or via **Telegram** when the bot is configured. Same delegation and help flow; the chosen channel is just where messages are sent and received.
- User sends a **task** or command from Telegram (e.g. “Run the daily report” or “Summarize the docs in folder X”).
- Agentron runs the same logic as in the Studio (chat + tools, or direct workflow execution).
- When the assistant or a workflow needs user input (`ask_user` / `request_user_help`), the user can be **asked in Telegram** and reply there.
- Replies from Agentron (and optionally notifications when help is needed) are sent back to the user on Telegram.

### 4.2 Architecture options

- **Telegram Bot API:** Bot receives updates (messages, callbacks) and sends replies. Two ways to receive updates:
  - **Long polling:** Bot calls `getUpdates` in a loop; no public URL needed; works behind NAT/firewall.
  - **Webhook:** Telegram POSTs to your HTTPS URL; lower latency, but requires a public URL and SSL.

- **Flow:**
  1. User sends a message to the bot (e.g. “Run workflow X” or “Daily summary”).
  2. Your service receives the update (polling or webhook).
  3. Either:
     - **Option 1:** Forward the message to the **same chat API** used by the Studio (`POST /api/chat` with the user message), and stream or collect the assistant’s reply; then send that reply (and any tool results / run status) back to Telegram. For `ask_user`, the assistant’s reply is the question; you send it in Telegram and wait for the next message from that user, then feed it as the next user message in the same conversation.
     - **Option 2:** Map Telegram chat to a “conversation” and run the assistant in the same way as the web UI, so conversation history is shared or mirrored.
  4. When a **workflow run** hits `request_user_help`, you need to correlate the run with a Telegram chat (e.g. run metadata or a “channel” table storing `runId -> telegramChatId`). Then send the question to that chat; when the user replies in Telegram, call `POST /api/runs/:id/respond` with the reply. (Today that completes the run; if you add true “resume,” you’d call that instead.)

### 4.3 Libraries

- **node-telegram-bot-api** (yagop): Popular, supports Bot API v9+, polling and webhooks. Simple for long polling.
- **grammY:** Modern, TypeScript-friendly, good for webhooks and structured bots.

### 4.4 Implementation sketch

1. **Bot process or route:**
   - If **long polling:** run a small Node script or a dedicated route that starts the bot and calls `bot.getUpdates` (or library equivalent) in a loop; on each message, call your chat API or workflow runner.
   - If **webhook:** add `POST /api/telegram/webhook` (or similar), verify it’s from Telegram, parse the update, then same as above.

2. **Conversation mapping:**
   - Store `telegramChatId -> conversationId` (and optionally `userId`) so multi-turn chat and “ask_user” work. When the user replies after an `ask_user`, send that reply as the next user message in the same conversation.

3. **Pending help from workflows:**
   - When a run enters `waiting_for_user`, if that run was triggered from Telegram (e.g. you stored `runId -> telegramChatId` when starting the run), send the run’s question to that chat. On reply in Telegram, call `POST /api/runs/:id/respond` with the message text.

4. **Security:**
   - Validate that updates are from Telegram (secret token in webhook URL or verify source). Optional: allow only specific Telegram user IDs. Do not expose internal IDs in Telegram messages unless necessary.

### 4.5 Optional: Notify via Telegram when help is needed

- Even for runs started from the **Studio**, you can optionally notify the user on Telegram when status becomes `waiting_for_user` (e.g. a "notification" Telegram chat ID in settings). That way they can respond from the Studio or from Telegram; if they respond from Telegram, use the same `respond` API.

### 4.6 Helping the user set up Telegram via the UI

Goal: guide the user through creating a bot and wiring it to Agentron without leaving the app. Follow the same patterns as **Settings → LLM Providers** (dedicated page, test connection, persisted config).

**Where in the app**

- **New page:** `Settings → Telegram` (e.g. `/settings/telegram`), with a link in the sidebar under Settings (next to "LLM Providers", "Local Models", "General") and in the main Settings page "Quick Links".
- **Single integration:** One Telegram bot per Studio instance (one token, one optional notification chat). No need for a list like LLM providers.

**What the user needs to do (and what the UI can explain)**

1. **Create a bot in Telegram** — Open Telegram, search for **@BotFather**, send `/newbot`. Choose a name and a username (e.g. `MyAgentronBot`). BotFather replies with a **token** (e.g. `123456:ABC-Def...`). The UI can show a short step-by-step (numbered list + link to [Telegram BotFather](https://t.me/BotFather)) and a note: "You need a Telegram account; the token is secret—paste it only here."

2. **Paste the token in Agentron** — Token field (masked input, same style as API keys on LLM page). Optional: support an **env var** (e.g. `TELEGRAM_BOT_TOKEN`) and show "Use environment variable" so the token is not stored on disk; mirror the `apiKeyRef` pattern used for LLM keys if desired.

3. **Test the connection** — "Test connection" button that calls `GET https://api.telegram.org/bot<token>/getMe` from the backend (or a small API route that does this and returns success + bot username, or an error). Show result: "Connected as @YourBotName" or "Invalid token / network error".

4. **Save** — Persist token (or env var name) and "Telegram enabled" in app settings. Store in the same place as other integration config—e.g. extend `app-settings.json` with `telegram?: { enabled: boolean; botToken?: string; botTokenEnvVar?: string; notificationChatId?: string }`, or a dedicated `telegram-settings.json` in the data dir. Do not log or expose the token in the UI after save (show only "••••••" or "Using TELEGRAM_BOT_TOKEN").

5. **Optional: Notification chat for pending help** — Optional field: "Notification chat ID (for 'Agent needs your input' alerts)". Help text: "When a run needs your input, the bot can send the question to this chat. To get your chat ID: start a chat with your bot in Telegram and send any message (e.g. /start); we can show the chat ID in the UI after the first message, or you can use an external tool (e.g. @userinfobot) and paste the number here." If you implement the bot first, the first time the user messages the bot you can store `chat_id` and show it in Settings as "Detected chat: 123456789 (use for notifications)".

**UI flow (concise)**

- **Settings → Telegram** page: Short intro ("Use Telegram to delegate tasks and reply when Agentron needs your input. Same as the in-app chat, from your phone or desktop."); Step 1 "Create a bot" (numbered steps + link to BotFather); Step 2 "Bot token" (masked input, optional "Use env var"); "Test connection" button; "Enable Telegram" toggle; optional "Notification chat ID"; Save.
- **Sidebar:** Add "Telegram" under Settings (e.g. icon: send/message).
- **Settings (General) Quick Links:** Add "Telegram →" linking to `/settings/telegram`.

**Security and storage**

- Treat the token as a secret: mask in UI, do not put in frontend bundle or client-visible API responses. Backend only.
- Prefer storing in a file in the data directory (e.g. `app-settings.json` with a `telegram` key) and exclude from backups if the user excludes secrets; or allow token via env only so nothing is on disk.
- Optional: allowlist of Telegram user IDs that can use the bot; bot ignores messages from others.

**References (in-repo)**

- **Settings pattern:** `packages/ui/app/settings/page.tsx` (Quick Links), `packages/ui/app/settings/llm/page.tsx` (form, test, list), `packages/ui/app/components/sidebar.tsx` (Settings items).
- **App settings storage:** `packages/ui/app/api/_lib/app-settings.ts`; can extend `AppSettings` with `telegram` or add a separate GET/PATCH for Telegram config.
- **Telegram getMe:** `https://api.telegram.org/bot<token>/getMe` (validates token and returns bot info).

---



## 5. Summary table

| Area | Current state | Suggested direction |
|------|----------------|---------------------|
| **Task delegation** | Chat creates agents/workflows and runs them; uses `ask_user` when needed | Keep; optionally add a “task” entity and clearer multi-workflow UX |
| **User-in-the-loop** | `ask_user` in chat; `request_user_help` in workflows; pending-help UI; respond marks run completed | Add optional Telegram (and push/email) for notifications; optionally design true “resume” later |
| **Task queue** | No queue; concurrent chat/workflow requests run in parallel | Serialize chat per conversation; cap concurrent workflow runs; scheduler enqueues jobs; optionally BullMQ for persistence and scale |
| **Cron / scheduling** | Modes and `schedule` in DB and UI; `WorkflowScheduler` exists but unused | Wire scheduler in-process; parse `schedule` (interval + daily@/weekly@); optionally add cron + BullMQ later |
| **Telegram** | None | Add bot (polling or webhook); map Telegram chat to conversation; call chat API and run execution; surface ask_user and request_user_help in Telegram; optional notifications for pending help; **Settings → Telegram** UI to guide setup (BotFather, token, test connection, optional notification chat ID) |

---

## 6. References

- **Workflow types:** `packages/core/src/types/workflow.ts`
- **Workflow scheduler:** `packages/runtime/src/workflow/scheduler.ts`
- **Run workflow:** `packages/ui/app/api/_lib/run-workflow.ts` (`request_user_help` and `waiting_for_user`)
- **Pending help API:** `packages/ui/app/api/runs/pending-help/route.ts`, `packages/ui/app/api/runs/[id]/respond/route.ts`
- **Chat tools:** `packages/runtime/src/chat/tools/conversation-tools.ts` (`ask_user`), `packages/runtime/src/chat/tools/prompt.ts`
- **Schedule UI:** `packages/ui/app/workflows/[id]/page.tsx` (executionMode, scheduleType, daily@, weekly@)
- **Task queue:** [p-queue](https://github.com/sindresorhus/p-queue) (in-memory, concurrency limit), [BullMQ](https://docs.bullmq.io/) (Redis-backed, workers, retries, repeatable jobs).
- **Telegram:** [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api), [grammY deployment](https://grammy.dev/guide/deployment-types); [cron-parser](https://www.npmjs.com/package/cron-parser), [BullMQ repeat strategies](https://docs.bullmq.io/guide/job-schedulers/repeat-strategies)
