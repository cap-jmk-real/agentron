import { json } from "../../_lib/response";
import { db, reminders, fromReminderRow } from "../../_lib/db";
import { cancelReminderTimeout } from "../../_lib/reminder-scheduler";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/** GET /api/reminders/:id — get one reminder. */
export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(reminders).where(eq(reminders.id, id));
  if (rows.length === 0) {
    return json({ error: "Not found" }, { status: 404 });
  }
  return json(fromReminderRow(rows[0]));
}

/** DELETE /api/reminders/:id — cancel a pending reminder. */
export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(reminders).where(eq(reminders.id, id));
  if (rows.length === 0) {
    return json({ error: "Not found" }, { status: 404 });
  }
  if (rows[0].status !== "pending") {
    return json({ error: "Reminder is not pending (already fired or cancelled)" }, { status: 400 });
  }
  await db.update(reminders).set({ status: "cancelled" }).where(eq(reminders.id, id)).run();
  cancelReminderTimeout(id);
  return json({ ok: true });
}
