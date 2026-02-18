# Queues and diagnosis

## Queues in the system

| Queue | Storage | Inspectable / copyable | API | Where to show in UI |
|-------|---------|------------------------|-----|----------------------|
| **Execution events** (per run) | DB (`execution_events`) | **Yes** – full list + run state | `GET /api/runs/:id/events` | Run detail page: "Event queue" section + "Copy for diagnosis" button |
| **Workflow run queue** | In-memory (`workflow-queue.ts`) | **No** – only status (length, running) | `GET /api/workflow-queue` | Settings or runs list: "Workflow queue: X queued, Y running" |
| **Rate-limit queue** | In-memory (rate limiter) | **Yes** – pending + recentDelayed | `GET /api/rate-limit/queue` | Settings / LLM: "Rate limit queue" (pending, recent delayed) |
| **Chat per-conversation** | In-memory (`chat-queue.ts`) | No – only one active per conversation | (none) | Optional: "Chat: 1 turn in progress" per conversation |

## Copy for diagnosis

- **Execution event queue** for a run is the only queue whose **full contents** you can copy (events + run state summary). Use `GET /api/runs/:id/events`; the response includes `copyForDiagnosis` (JSON string) and `events` / `runState` for pasting into support or debugging.
- Workflow queue and rate-limit queue expose **status only** (counts, recent items); their full contents are not stored or exposed.

## UI placement suggestions

1. **Run detail page** (`/runs/[id]`): Add an "Event queue" or "Diagnosis" card when the run uses the event-driven engine (e.g. when `GET /api/runs/:id/events` returns events). Show event list (sequence, type, processedAt) and a "Copy for diagnosis" button that copies `copyForDiagnosis` to the clipboard.
2. **Runs list or Settings**: Optional "Queue status" line: "Workflow queue: N queued, M running" from `GET /api/workflow-queue`.
3. **Settings / LLM**: "Rate limit queue" from `GET /api/rate-limit/queue` (pending and recentDelayed) if you already have a rate-limit UI.
