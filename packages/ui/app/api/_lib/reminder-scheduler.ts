/**
 * In-process scheduler for one-shot reminders. On fire: marks reminder as fired and either
 * posts a static message (taskType "message") or runs one assistant turn (taskType "assistant_task").
 */
import { eq } from "drizzle-orm";
import { db, reminders, chatMessages } from "./db";
import { fromReminderRow, toChatMessageRow } from "./db";
import { runScheduledTurn } from "./run-scheduled-turn";

const timeouts = new Map<string, NodeJS.Timeout>();

export async function fireReminder(id: string): Promise<void> {
  const rows = await db.select().from(reminders).where(eq(reminders.id, id));
  const row = rows[0];
  if (!row || row.status !== "pending") {
    timeouts.delete(id);
    return;
  }
  const now = Date.now();
  await db
    .update(reminders)
    .set({ status: "fired", firedAt: now })
    .where(eq(reminders.id, id))
    .run();
  timeouts.delete(id);

  const taskType = (row.taskType ?? "message") as "message" | "assistant_task";
  const conversationId = row.conversationId ?? null;

  if (taskType === "assistant_task" && conversationId) {
    await db
      .insert(chatMessages)
      .values(
        toChatMessageRow({
          id: crypto.randomUUID(),
          conversationId,
          role: "user",
          content: row.message,
          createdAt: now,
        })
      )
      .run();
    try {
      await runScheduledTurn(conversationId, row.message);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db
        .insert(chatMessages)
        .values(
          toChatMessageRow({
            id: crypto.randomUUID(),
            conversationId,
            role: "assistant",
            content: `[Scheduled task failed: ${msg}]`,
            createdAt: Date.now(),
          })
        )
        .run();
    }
    return;
  }

  if (conversationId) {
    const content = `**Reminder:** ${row.message}`;
    await db
      .insert(chatMessages)
      .values(
        toChatMessageRow({
          id: crypto.randomUUID(),
          conversationId,
          role: "assistant",
          content,
          createdAt: now,
        })
      )
      .run();
  }
}

function scheduleOne(reminder: ReturnType<typeof fromReminderRow>): void {
  if (reminder.status !== "pending") return;
  const now = Date.now();
  if (reminder.runAt <= now) {
    void fireReminder(reminder.id);
    return;
  }
  const delayMs = reminder.runAt - now;
  const t = setTimeout(() => {
    void fireReminder(reminder.id);
  }, delayMs);
  timeouts.set(reminder.id, t);
}

/**
 * Schedule a single reminder by id (e.g. after creating it). No-op if not found or not pending.
 */
export function scheduleReminder(id: string): void {
  void (async () => {
    const rows = await db.select().from(reminders).where(eq(reminders.id, id));
    if (rows.length === 0) return;
    const reminder = fromReminderRow(rows[0]);
    if (reminder.status !== "pending") return;
    scheduleOne(reminder);
  })();
}

/**
 * Clear all reminder timeouts and reload pending reminders from the DB. Call on server start
 * and optionally when reminders are bulk-updated. Overdue pending reminders are fired immediately.
 */
export function refreshReminderScheduler(): void {
  for (const t of timeouts.values()) clearTimeout(t);
  timeouts.clear();
  void (async () => {
    const rows = await db.select().from(reminders).where(eq(reminders.status, "pending"));
    for (const row of rows) {
      scheduleOne(fromReminderRow(row));
    }
  })();
}

/**
 * Cancel a scheduled timeout for a reminder (e.g. when reminder is cancelled). Does not update DB.
 */
export function cancelReminderTimeout(id: string): void {
  const t = timeouts.get(id);
  if (t) {
    clearTimeout(t);
    timeouts.delete(id);
  }
}
