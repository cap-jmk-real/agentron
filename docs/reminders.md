# Reminders

Agentron supports **one-shot reminders** that you can create from the chat. When the reminder time is reached, the reminder text is posted into the same chat (so you see it when you open that conversation).

## Creating reminders in chat

In the chat, you can say things like:

- **“Remind me in 20 minutes to call John.”**
- **“Remind me at 3pm to submit the report.”**
- **“Set a reminder for tomorrow at 9am: review the draft.”**

The assistant uses the **create_reminder** tool with:

- **message** — The text you want to see when the reminder fires (e.g. “Call John”).
- **at** — An ISO 8601 date/time (e.g. `2026-02-16T15:00:00Z`) when you specify an exact time.
- **inMinutes** — Minutes from now (e.g. 20 for “in 20 minutes”, 60 for “in 1 hour”).

Reminders created from the chat are tied to **that conversation**. When the reminder fires, a message like **“Reminder: Call John”** is added to the same chat so you see it when you open it.

### Scheduling a task for the assistant

You can also **schedule a task for the assistant** so it runs at a specific time in that chat (e.g. at 9am have the assistant summarize my calendar). The assistant uses **create_reminder** with **taskType: assistant_task** and **message** set to the task. When the time comes, that text is added as a **user** message and the assistant runs one full turn; the reply appears in the same conversation. **assistant_task** requires a conversation so the reply has a place to go.

## Listing and cancelling

- **“What reminders do I have?”** / **“Show my reminders”** — The assistant calls **list_reminders** and shows pending (or optionally fired/cancelled) reminders.
- **“Cancel that reminder”** / **“Remove the reminder”** — The assistant uses **cancel_reminder** with the reminder id from **list_reminders**.

## API (for integrations)

| Method | Endpoint | Description |
|--------|----------|-------------|
| **POST** | `/api/reminders` | Create a reminder. Body: `{ "message": "…", "at": "2026-02-16T15:00:00Z" }` or `{ "message": "…", "inMinutes": 20 }`. Optional: `conversationId` (required if `taskType` is `assistant_task`), `taskType`: `"message"` (default) or `"assistant_task"` (run the assistant with the message as the user prompt). |
| **GET** | `/api/reminders?status=pending` | List reminders (status: `pending`, `fired`, or `cancelled`; default `pending`). |
| **GET** | `/api/reminders/:id` | Get one reminder by id. |
| **DELETE** | `/api/reminders/:id` | Cancel a pending reminder. |

## How it works

- Reminders are stored in the database and survive server restarts.
- An **in-process scheduler** runs in the same Node process as the app. On server start it loads all pending reminders and schedules a timeout for each. When a reminder is created (via API or chat), it is scheduled immediately.
- When the time is reached, the reminder’s status is set to **fired** and, if a **conversationId** was set, a message is inserted into that conversation so it appears in the chat.

## Recurring tasks (workflows)

For **recurring** tasks (e.g. “run every morning at 8”), use **workflows** with a schedule. In the chat you can say things like “Create a workflow that runs every day at 9am” and the assistant will create a workflow with `executionMode: "interval"` and `schedule: "daily@09:00"`. See [Workflows](../apps/docs/docs/concepts/workflows.md) and the plan document [Reminders and cron — plan](reminders-and-cron-plan.md).
