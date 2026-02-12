import { json } from "../../_lib/response";
import { db, tasks, fromTaskRow, toTaskRow } from "../../_lib/db";
import { eq } from "drizzle-orm";
import type { TaskRow } from "../../_lib/db";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(tasks).where(eq(tasks.id, id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });
  return json(fromTaskRow(rows[0]));
}

/** PATCH - resolve task: set status to approved or rejected, optional output/resolvedBy */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(tasks).where(eq(tasks.id, id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });
  const existing = fromTaskRow(rows[0]);
  if (existing.status !== "pending_approval") {
    return json({ error: "Task already resolved" }, { status: 400 });
  }
  const body = await request.json();
  const newStatus = body.status === "rejected" ? "rejected" : "approved";
  const updated: TaskRow = {
    ...existing,
    status: newStatus,
    output: body.output !== undefined ? body.output : existing.output,
    resolvedAt: Date.now(),
    resolvedBy: body.resolvedBy ?? "user",
  };
  await db.update(tasks).set(toTaskRow(updated)).where(eq(tasks.id, id)).run();
  return json(updated);
}
