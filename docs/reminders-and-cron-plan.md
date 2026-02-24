# Reminders and cron scheduled tasks — plan

This document plans whether Agentron should have **reminders** (one-shot at a time) and **cron-style scheduled tasks**, how to implement them, and how **scheduling via chat** would work. It uses [OpenClaw’s cron](https://docs.openclaw.ai/automation/cron-jobs) as a reference.

## Implementation status

**Reminders (one-shot)** are implemented:

- **Schema:** `reminders` table in core DB (id, runAt, message, conversationId, status, createdAt, firedAt). Status: `pending` | `fired` | `cancelled`.
- **Scheduler:** `packages/ui/app/api/_lib/reminder-scheduler.ts` — in-process timeouts; on fire: mark `fired`, optionally post reminder message into the linked conversation. `refreshReminderScheduler()` on server start; `scheduleReminder(id)` when a reminder is created.
- **API:** `POST /api/reminders` (body: message, at or inMinutes, optional conversationId), `GET /api/reminders?status=pending|fired|cancelled`, `GET /api/reminders/:id`, `DELETE /api/reminders/:id` (cancel).
- **Chat tools:** `create_reminder`, `list_reminders`, `cancel_reminder`. The assistant uses them when the user says “remind me in 20 minutes”, “remind me at 3pm”, or “at 9am have the assistant summarize my calendar”. Reminders support **taskType**: `message` (post static text) or `assistant_task` (insert user message and run one assistant turn so the assistant does the task at that time). Reminders created from chat are tied to the current conversation.
- **Docs:** See [Reminders](reminders.md) for user-facing documentation.

**Recurring scheduled workflows** were already implemented (interval, daily@, weekly@, continuous) in `scheduled-workflows.ts`; scheduling via chat uses `create_workflow` / `update_workflow` with `executionMode` and `schedule`.

---

## 1. Recommendation: should Agentron have them?

**Yes.** Reasons:

- **Scheduling via chat** is a natural ask (“remind me in 20 minutes”, “run this every morning at 8”). Today the assistant can create a **workflow** with `executionMode: "interval"` and `schedule: "daily@08:00"`, but there is no first-class **reminder** (one-shot at a specific time) and no single place to list “all my scheduled things” (workflows vs reminders).
- **Reminders** are different from workflows: lightweight “poke me at X” or “run this once at X” without forcing the user into a multi-agent workflow. OpenClaw treats them as first-class (`schedule.kind = "at"`).
- **Unified model** improves UX: user says “remind me to X” or “run Y every day at 9” in chat; the assistant creates either a reminder or a scheduled workflow and the user sees it in one place (e.g. Settings → Schedules, or a “Reminders & schedules” section).

So the product direction should be:

1. **Keep and use** the existing **workflow scheduler** for recurring workflows (interval, daily@, weekly@, continuous). It is already wired in `scheduled-workflows.ts` and refreshed on workflow create/update/delete.
2. **Add first-class reminders**: one-shot “at” times (and optionally “in N minutes”), persisted, with a small scheduler that fires at the right time and either delivers a message to the user (e.g. in chat) or triggers a single workflow run.
3. **Optionally** extend workflow schedules with **standard cron + timezone** (like OpenClaw’s `cron` kind) for power users; not required for the first iteration.

---

## 2. How OpenClaw does it

Summary from [OpenClaw Cron Jobs](https://docs.openclaw.ai/automation/cron-jobs) and [CLI cron](https://docs.openclaw.ai/cli/cron):

- **Storage:** Jobs persist in `~/.openclaw/cron/jobs.json`; Gateway loads on start and writes on change. Restarts do not lose schedules.
- **Schedule kinds:**
  - **`at`** — One-shot at an ISO 8601 timestamp. Often `deleteAfterRun: true`.
  - **`every`** — Fixed interval in milliseconds.
  - **`cron`** — 5-field cron expression with optional IANA timezone (e.g. `0 7 * * *`, `America/Los_Angeles`).
- **Execution context:**
  - **Main session** — Enqueues a system event; agent runs in normal conversation with full history. Uses heartbeat.
  - **Isolated session** — Dedicated agent turn in a `cron:` session; no conversation carry-over. Can deliver output to a channel (Slack, Telegram, etc.).
- **API:** Gateway exposes `cron.add`, `cron.update`, `cron.run`, `cron.remove`, `cron.list`, etc. CLI wraps these (`openclaw cron add/list/run/edit`). Agents can schedule via **tool calls** (same JSON schema).
- **One-shot reminder example:**  
  `openclaw cron add --name "Reminder" --at "2026-02-01T16:00:00Z" --session main --system-event "Reminder text" --wake now --delete-after-run`
- **Recurring isolated job:**  
  `openclaw cron add --name "Morning brief" --cron "0 7 * * *" --tz "America/Los_Angeles" --session isolated --message "Summarize overnight." --announce --channel slack --to "channel:C123"`

Takeaways for Agentron:

- Persist schedules (file or DB) so restarts don’t lose them.
- Support **at** (one-shot) and **every**/interval and optionally **cron** + tz.
- Expose a **tool/API** so the chat assistant can create/update/delete reminders and scheduled jobs.
- Decide what “run” means: in Agentron, “run” can be “post a message to the user in chat” (reminder) or “execute a workflow once” (scheduled workflow run).

---

## 3. Implementation options

### 3.1 Reminders (one-shot “at” and “in N minutes”)

**Option A: Reminders as data + in-process scheduler**

- **Schema:** New table or store (e.g. `reminders` or `scheduled_jobs` with `kind: "reminder"`):
  - `id`, `userId`/conversation or global, `at` (ISO timestamp or `runAt` ms), `message` or `payload`, `status` (`pending` | `fired` | `cancelled`), `createdAt`.
- **Scheduler:** Single in-process loop (e.g. every 30s) or a `setTimeout` per reminder. On “fire”: post the reminder into the chat (e.g. as a system message or a bot message in that conversation) or call a small callback (e.g. trigger a workflow run). Mark `status: fired`.
- **Persistence:** Same DB as workflows (e.g. SQLite via existing `db`). No new infra.
- **Chat:** New tool `create_reminder` (e.g. `{ at: "2026-02-16T14:00:00Z" }` or `{ inMinutes: 20 }`, `message: "..."`). Assistant uses it when the user says “remind me in 20 minutes to …” or “remind me at 3pm to …”.

**Option B: Reuse workflow scheduler with “one-shot workflow”**

- Create a special workflow (or a branch) that runs **once** at a given time: e.g. `executionMode: "one_time"` and a separate “scheduled run at T” queue. The scheduler would maintain a list of “run workflow W at T” and use the same `setTimeout`/next-run logic as calendar (daily/weekly).
- **Pros:** Reuses execution path. **Cons:** Reminders are heavyweight (full workflow), and you still need a place to store “run workflow X at T” and a way for the user to say “remind me” without creating a workflow.

**Recommendation:** Option A — dedicated reminders store + in-process scheduler. Simple, matches user mental model (“reminder” vs “workflow”), and chat can expose `create_reminder` / `list_reminders` / `cancel_reminder` without touching workflow semantics.

### 3.2 Recurring scheduled tasks (cron / interval)

Agentron **already** has this for workflows:

- **Workflows** with `executionMode: "interval"` or `"continuous"` and `schedule` are driven by `scheduled-workflows.ts` (interval, daily@, weekly@, continuous). Runs are enqueued via `enqueueWorkflowRun` so they don’t stack.
- **Chat:** The assistant already creates/updates workflows with `update_workflow(..., schedule, executionMode)` and can set `daily@09:00`, `weekly@1,3,5`, or interval seconds. So “schedule via chat” for **recurring** workflows is already supported; the main gap is **discoverability** (e.g. “what’s scheduled?”) and **reminders**.

Optional enhancements:

- **Cron expressions + timezone:** Add a `schedule` format like `cron:0 7 * * *` and `tz: America/Los_Angeles` and use a library (e.g. `cron-parser`) to compute next run. Then the same `refreshScheduledWorkflows` (or a sibling) can register cron-based workflow runs.
- **Unified “scheduled jobs” list:** A single UI (and API) that shows both “reminders” and “scheduled workflows” (and optionally one-shot “run workflow at T” if you add that later). OpenClaw’s `cron list` is the mental model.

### 3.3 What “run” means for a reminder

When a reminder fires:

- **Option 1 (simplest):** Post a **message into the user’s chat** (e.g. the conversation that created the reminder, or a “Reminders” conversation). The message could be a system/bot line: “Reminder: …” with the stored message. No workflow run.
- **Option 2:** Trigger a **single run** of a specific workflow (e.g. “morning brief” workflow). Then the reminder is “run workflow W at T”; you need to associate a reminder with a workflow id.
- **Option 3:** Both: reminder has type `message` | `workflow`; `message` posts to chat, `workflow` runs one execution.

For v1, Option 1 is enough; Option 3 can be added later.

---

## 4. Chat integration (scheduling via chat)

- **Reminders:**  
  - `create_reminder({ at?: string, inMinutes?: number, message: string })`  
  - `list_reminders()`  
  - `cancel_reminder({ id: string })`  
  Assistant uses these when the user says “remind me in 20 minutes to …”, “remind me at 3pm”, “what reminders do I have?”, “cancel that reminder”.

- **Recurring:**  
  - Already: `create_workflow` + `update_workflow` with `executionMode: "interval"` and `schedule: "3600"` | `"daily@09:00"` | `"weekly@1,3,5"`.  
  - Optional: `list_scheduled_workflows()` or extend `list_workflows` to include schedule info so the assistant can answer “what’s scheduled?”.

- **Prompt:** Add a short line to the system prompt: when the user asks to be reminded at a time or in N minutes, use `create_reminder`; when they ask for something to run periodically, use workflows with the right `executionMode` and `schedule`.

---

## 5. Implementation sketch (reminders)

1. **Schema (e.g. in `packages/core` or UI db):**
   - `reminders` table: `id`, `runAt` (ms or ISO), `message`, `conversationId` (optional), `status`, `createdAt`. Optional: `workflowId` for “run workflow at T” later.

2. **Scheduler (same process as Studio):**
   - On startup, load `reminders` where `status = 'pending'` and `runAt > now`. For each, `setTimeout` to fire at `runAt`. On fire: (a) post message to chat (e.g. POST to an internal “reminder callback” or append to conversation), (b) set `status = 'fired'`.
   - When a new reminder is created (via API/tool), schedule its `setTimeout` and store it.

3. **API:**
   - `POST /api/reminders` — create (body: `at` or `inMinutes`, `message`, optional `conversationId`).
   - `GET /api/reminders` — list pending (and optionally recent fired).
   - `DELETE /api/reminders/:id` — cancel (set `status = 'cancelled'` and clear timeout if in-memory).

4. **Chat tools:**
   - `create_reminder`, `list_reminders`, `cancel_reminder` (implemented in chat route or via API calls from the same backend).

5. **Delivery:** When a reminder fires, either:
   - Insert a “reminder” message into the conversation (if you have a way to push into a conversation from the server), or
   - Expose “pending reminders” in the UI (e.g. banner or sidebar) and mark as “due” so the user sees it when they open the app. Full “post into chat” may require a small real-time channel (e.g. polling or WebSocket for “new reminder” events).

---

## 6. Summary

| Area | Recommendation |
|------|----------------|
| **Reminders** | Add first-class reminders: one-shot “at” (and “in N minutes”), persisted in DB, in-process scheduler, fire by posting to chat or a “due” list. |
| **Recurring** | Keep current workflow scheduler (interval, daily@, weekly@, continuous); scheduling via chat already works via `update_workflow`. Optionally add cron expr + tz later. |
| **OpenClaw alignment** | Persist jobs; support `at` and interval; expose tools/API for create/list/cancel; keep “run” semantics simple (message vs workflow run). |
| **Chat** | Add `create_reminder`, `list_reminders`, `cancel_reminder`; keep using `create_workflow` / `update_workflow` for recurring workflows. |

This gives Agentron a clear path to reminders and cron-style scheduling while reusing the existing workflow scheduler and aligning with how OpenClaw structures cron (persistence, schedule kinds, tool-call API).
