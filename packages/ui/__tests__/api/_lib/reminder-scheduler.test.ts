import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fireReminder,
  scheduleReminder,
  refreshReminderScheduler,
  cancelReminderTimeout,
} from "../../../app/api/_lib/reminder-scheduler";
import { db, reminders, toReminderRow, chatMessages } from "../../../app/api/_lib/db";
import { eq } from "drizzle-orm";
import type { Reminder } from "../../../app/api/_lib/db-mappers";
import { runScheduledTurn } from "../../../app/api/_lib/run-scheduled-turn";

vi.mock("../../../app/api/_lib/run-scheduled-turn", () => ({
  runScheduledTurn: vi.fn().mockResolvedValue(undefined),
}));

describe("reminder-scheduler", () => {
  beforeEach(async () => {
    try {
      await db.delete(reminders).where(eq(reminders.id, "rem-test-1")).run();
    } catch {}
    try {
      await db.delete(reminders).where(eq(reminders.id, "rem-test-2")).run();
    } catch {}
    try {
      await db.delete(reminders).where(eq(reminders.id, "rem-test-3")).run();
    } catch {}
  });

  it("fireReminder is no-op when reminder not found", async () => {
    await expect(fireReminder("non-existent-id")).resolves.toBeUndefined();
  });

  it("fireReminder is no-op when reminder status is not pending", async () => {
    const row = toReminderRow({
      id: "rem-test-1",
      runAt: Date.now() + 60000,
      message: "m",
      taskType: "message",
      status: "fired",
      createdAt: Date.now(),
    } as Reminder);
    await db.insert(reminders).values(row).run();
    await fireReminder("rem-test-1");
    const rows = await db.select().from(reminders).where(eq(reminders.id, "rem-test-1"));
    expect(rows[0]?.status).toBe("fired");
  });

  it("fireReminder marks as fired and posts message when taskType message and conversationId set", async () => {
    const now = Date.now();
    const convId = "conv-rem-test-" + Date.now();
    const row = toReminderRow({
      id: "rem-test-2",
      runAt: now - 1,
      message: "Hello",
      conversationId: convId,
      taskType: "message",
      status: "pending",
      createdAt: now,
    } as Reminder);
    await db.insert(reminders).values(row).run();
    await fireReminder("rem-test-2");
    const rows = await db.select().from(reminders).where(eq(reminders.id, "rem-test-2"));
    expect(rows[0]?.status).toBe("fired");
    const messages = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, convId));
    expect(messages.some((m) => m.content?.includes("**Reminder:** Hello"))).toBe(true);
  });

  it("fireReminder with assistant_task and conversationId inserts user message and runs scheduled turn", async () => {
    const convId = "conv-assistant-" + Date.now();
    const id = "rem-assistant-" + Date.now();
    const now = Date.now();
    const row = toReminderRow({
      id,
      runAt: now - 1,
      message: "Scheduled task input",
      conversationId: convId,
      taskType: "assistant_task",
      status: "pending",
      createdAt: now,
    } as Reminder);
    await db.insert(reminders).values(row).run();
    await fireReminder(id);
    expect(vi.mocked(runScheduledTurn)).toHaveBeenCalledWith(convId, "Scheduled task input");
    const messages = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, convId));
    expect(messages.some((m) => m.role === "user" && m.content === "Scheduled task input")).toBe(
      true
    );
    await db.delete(reminders).where(eq(reminders.id, id)).run();
  });

  it("fireReminder with assistant_task inserts assistant error message when runScheduledTurn throws", async () => {
    vi.mocked(runScheduledTurn).mockRejectedValueOnce(new Error("Turn failed"));
    const convId = "conv-err-" + Date.now();
    const id = "rem-err-" + Date.now();
    const now = Date.now();
    const row = toReminderRow({
      id,
      runAt: now - 1,
      message: "Task",
      conversationId: convId,
      taskType: "assistant_task",
      status: "pending",
      createdAt: now,
    } as Reminder);
    await db.insert(reminders).values(row).run();
    await fireReminder(id);
    const messages = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, convId));
    expect(
      messages.some((m) => m.role === "assistant" && m.content?.includes("Scheduled task failed"))
    ).toBe(true);
    await db.delete(reminders).where(eq(reminders.id, id)).run();
  });

  it("scheduleReminder schedules pending reminder with future runAt (setTimeout path)", async () => {
    const id = "rem-future-" + Date.now();
    const runAt = Date.now() + 5000;
    await db
      .insert(reminders)
      .values(
        toReminderRow({
          id,
          runAt,
          message: "Later",
          taskType: "message",
          status: "pending",
          createdAt: Date.now(),
        } as Reminder)
      )
      .run();
    scheduleReminder(id);
    await new Promise((r) => setTimeout(r, 100));
    cancelReminderTimeout(id);
    await db.delete(reminders).where(eq(reminders.id, id)).run();
  });

  it("scheduleReminder with future runAt fires after delay (timeouts.set path)", async () => {
    const id = "rem-timer-fire-" + Date.now();
    const convId = "conv-timer-" + Date.now();
    vi.useFakeTimers();
    const runAt = Date.now() + 2000;
    await db
      .insert(reminders)
      .values(
        toReminderRow({
          id,
          runAt,
          message: "Scheduled",
          conversationId: convId,
          taskType: "message",
          status: "pending",
          createdAt: Date.now(),
        } as Reminder)
      )
      .run();
    try {
      scheduleReminder(id);
      await vi.advanceTimersByTimeAsync(2500);
      const rows = await db.select().from(reminders).where(eq(reminders.id, id));
      expect(rows[0]?.status).toBe("fired");
    } finally {
      vi.useRealTimers();
      await db.delete(reminders).where(eq(reminders.id, id)).run();
    }
  });

  it("scheduleReminder fires immediately when runAt is in the past", async () => {
    const id = "rem-past-" + Date.now();
    const convId = "conv-past-" + Date.now();
    await db
      .insert(reminders)
      .values(
        toReminderRow({
          id,
          runAt: Date.now() - 1000,
          message: "Past",
          conversationId: convId,
          taskType: "message",
          status: "pending",
          createdAt: Date.now(),
        } as Reminder)
      )
      .run();
    scheduleReminder(id);
    await new Promise((r) => setTimeout(r, 200));
    const rows = await db.select().from(reminders).where(eq(reminders.id, id));
    expect(rows[0]?.status).toBe("fired");
    await db.delete(reminders).where(eq(reminders.id, id)).run();
  });

  it("refreshReminderScheduler loads pending reminders and schedules them", async () => {
    const id = "rem-refresh-" + Date.now();
    await db
      .insert(reminders)
      .values(
        toReminderRow({
          id,
          runAt: Date.now() + 10000,
          message: "Refresh",
          taskType: "message",
          status: "pending",
          createdAt: Date.now(),
        } as Reminder)
      )
      .run();
    refreshReminderScheduler();
    await new Promise((r) => setTimeout(r, 150));
    cancelReminderTimeout(id);
    await db.delete(reminders).where(eq(reminders.id, id)).run();
  });

  it("cancelReminderTimeout clears timeout when one exists", async () => {
    const id = "rem-cancel-" + Date.now();
    await db
      .insert(reminders)
      .values(
        toReminderRow({
          id,
          runAt: Date.now() + 10000,
          message: "Cancel",
          taskType: "message",
          status: "pending",
          createdAt: Date.now(),
        } as Reminder)
      )
      .run();
    scheduleReminder(id);
    await new Promise((r) => setTimeout(r, 100));
    cancelReminderTimeout(id);
    await db.delete(reminders).where(eq(reminders.id, id)).run();
  });

  it("cancelReminderTimeout is no-op when no timeout for id", () => {
    expect(() => cancelReminderTimeout("no-such-id")).not.toThrow();
  });

  it("scheduleReminder does not throw for non-existent id", () => {
    expect(() => scheduleReminder("non-existent")).not.toThrow();
  });

  it("refreshReminderScheduler does not throw", () => {
    expect(() => refreshReminderScheduler()).not.toThrow();
  });
});
