import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fireReminder,
  scheduleReminder,
  refreshReminderScheduler,
  cancelReminderTimeout,
} from "../../../app/api/_lib/reminder-scheduler";
import { db, reminders, toReminderRow } from "../../../app/api/_lib/db";
import { eq } from "drizzle-orm";
import type { Reminder } from "../../../app/api/_lib/db-mappers";

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
    const row = toReminderRow({
      id: "rem-test-2",
      runAt: now - 1,
      message: "Hello",
      conversationId: "conv-rem-test",
      taskType: "message",
      status: "pending",
      createdAt: now,
    } as Reminder);
    await db.insert(reminders).values(row).run();
    await fireReminder("rem-test-2");
    const rows = await db.select().from(reminders).where(eq(reminders.id, "rem-test-2"));
    expect(rows[0]?.status).toBe("fired");
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
