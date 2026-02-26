/**
 * Tool handlers for reminders: create_reminder, list_reminders, cancel_reminder.
 */
import type { ExecuteToolContext } from "./execute-tool-shared";
import { db, reminders, fromReminderRow, toReminderRow } from "../../_lib/db";
import { scheduleReminder, cancelReminderTimeout } from "../../_lib/reminder-scheduler";
import { eq, desc } from "drizzle-orm";

export const REMINDERS_TOOL_NAMES = [
  "create_reminder",
  "list_reminders",
  "cancel_reminder",
] as const;

export async function handleReminderTools(
  name: string,
  a: Record<string, unknown>,
  ctx: ExecuteToolContext | undefined
): Promise<unknown> {
  const conversationId = ctx?.conversationId;

  switch (name) {
    case "create_reminder": {
      const msg = typeof a.message === "string" ? (a.message as string).trim() : "";
      if (!msg) return { error: "message is required" };
      const asTask = a.taskType === "assistant_task";
      if (asTask && !conversationId)
        return { error: "Cannot schedule an assistant task without a conversation (use in chat)." };
      let runAt: number;
      if (typeof a.at === "string" && (a.at as string).trim()) {
        const t = Date.parse((a.at as string).trim());
        if (Number.isNaN(t)) return { error: "at must be a valid ISO 8601 date string" };
        runAt = t;
      } else if (typeof a.inMinutes === "number" && (a.inMinutes as number) > 0) {
        runAt = Date.now() + Math.min(a.inMinutes as number, 60 * 24 * 365) * 60 * 1000;
      } else {
        return { error: "Either at (ISO date) or inMinutes (number) is required" };
      }
      if (runAt <= Date.now()) return { error: "Reminder time must be in the future" };
      const id = crypto.randomUUID();
      const taskType = asTask ? ("assistant_task" as const) : ("message" as const);
      const reminder = {
        id,
        runAt,
        message: msg,
        conversationId: conversationId ?? null,
        taskType,
        status: "pending" as const,
        createdAt: Date.now(),
        firedAt: null,
      };
      await db.insert(reminders).values(toReminderRow(reminder)).run();
      scheduleReminder(id);
      return {
        id,
        runAt,
        reminderMessage: msg,
        taskType,
        status: "pending",
        createdAt: reminder.createdAt,
        message: asTask
          ? "Scheduled task set. The assistant will run this in the chat when it's time."
          : "Reminder set. You'll see it in this chat when it fires.",
      };
    }
    case "list_reminders": {
      const status = (a.status === "fired" || a.status === "cancelled" ? a.status : "pending") as
        | "pending"
        | "fired"
        | "cancelled";
      const rows = await db
        .select()
        .from(reminders)
        .where(eq(reminders.status, status))
        .orderBy(desc(reminders.runAt));
      return { reminders: rows.map(fromReminderRow), message: `${rows.length} reminder(s).` };
    }
    case "cancel_reminder": {
      const rid = typeof a.id === "string" ? (a.id as string).trim() : "";
      if (!rid) return { error: "id is required" };
      const rRows = await db.select().from(reminders).where(eq(reminders.id, rid));
      if (rRows.length === 0) return { error: "Reminder not found" };
      if (rRows[0].status !== "pending")
        return { error: "Reminder is not pending (already fired or cancelled)" };
      await db.update(reminders).set({ status: "cancelled" }).where(eq(reminders.id, rid)).run();
      cancelReminderTimeout(rid);
      return { message: "Reminder cancelled." };
    }
    default:
      return undefined;
  }
}
