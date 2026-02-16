# Reminders

Agentron supports **one-shot reminders** that you can create from the chat. When the reminder time is reached, the reminder text is posted into the same chat so you see it when you open that conversation.

## Creating reminders in chat

In the chat, you can say things like:

- **"Remind me in 20 minutes to call John."**
- **"Remind me at 3pm to submit the report."**
- **"Set a reminder for tomorrow at 9am: review the draft."**

The assistant uses the **create_reminder** tool with a **message** and either **at** (ISO 8601 time) or **inMinutes**. Reminders created from the chat are tied to that conversation; when the reminder fires, a message like **"Reminder: Call John"** is added to the same chat.

## Listing and cancelling

- **"What reminders do I have?"** / **"Show my reminders"** — The assistant calls **list_reminders**.
- **"Cancel that reminder"** — The assistant uses **cancel_reminder** with the id from **list_reminders**.

## API

- **POST /api/reminders** — Create. Body: `{ "message": "…", "at": "2026-02-16T15:00:00Z" }` or `{ "message": "…", "inMinutes": 20 }`. Optional: `conversationId` so the reminder posts into that chat.
- **GET /api/reminders?status=pending** — List (status: `pending` | `fired` | `cancelled`).
- **GET /api/reminders/:id** — Get one.
- **DELETE /api/reminders/:id** — Cancel a pending reminder.

## Recurring tasks

For **recurring** tasks (e.g. "run every morning at 8"), use **workflows** with a schedule. See [Workflows](concepts/workflows.md).
