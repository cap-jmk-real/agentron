import { json } from "../_lib/response";
import { db, reminders, fromReminderRow, toReminderRow, type ReminderTaskType } from "../_lib/db";
import { scheduleReminder } from "../_lib/reminder-scheduler";
import { eq, desc } from "drizzle-orm";

export const runtime = "nodejs";

/** GET /api/reminders — list reminders. Query: status=pending|fired|cancelled (default: pending). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "pending";
  const validStatus = status === "pending" || status === "fired" || status === "cancelled" ? status : "pending";
  const rows = await db
    .select()
    .from(reminders)
    .where(eq(reminders.status, validStatus))
    .orderBy(desc(reminders.runAt));
  return json(rows.map(fromReminderRow));
}

/** POST /api/reminders — create a reminder. Body: { message, at?: ISO8601, inMinutes?: number, conversationId?: string }. */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    message?: string;
    at?: string;
    inMinutes?: number;
    conversationId?: string;
    taskType?: "message" | "assistant_task";
  };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return json({ error: "message is required" }, { status: 400 });
  }
  let runAt: number;
  if (typeof body.at === "string" && body.at.trim()) {
    const t = Date.parse(body.at.trim());
    if (Number.isNaN(t)) {
      return json({ error: "at must be a valid ISO 8601 date string" }, { status: 400 });
    }
    runAt = t;
  } else if (typeof body.inMinutes === "number" && body.inMinutes > 0) {
    runAt = Date.now() + Math.min(body.inMinutes, 60 * 24 * 365) * 60 * 1000;
  } else {
    return json({ error: "Either at (ISO date) or inMinutes (number) is required" }, { status: 400 });
  }
  if (runAt <= Date.now()) {
    return json({ error: "Reminder time must be in the future" }, { status: 400 });
  }
  const taskType: ReminderTaskType = body.taskType === "assistant_task" ? "assistant_task" : "message";
  if (taskType === "assistant_task" && !body.conversationId) {
    return json({ error: "conversationId is required for assistant_task reminders" }, { status: 400 });
  }
  const id = crypto.randomUUID();
  const conversationId = typeof body.conversationId === "string" && body.conversationId.trim() ? body.conversationId.trim() : undefined;
  const reminder = {
    id,
    runAt,
    message,
    conversationId: conversationId ?? null,
    taskType,
    status: "pending" as const,
    createdAt: Date.now(),
    firedAt: null,
  };
  await db.insert(reminders).values(toReminderRow(reminder)).run();
  scheduleReminder(id);
  return json(
    { id, runAt, message, conversationId: conversationId ?? undefined, taskType, status: "pending" as const, createdAt: reminder.createdAt },
    { status: 201 }
  );
}
