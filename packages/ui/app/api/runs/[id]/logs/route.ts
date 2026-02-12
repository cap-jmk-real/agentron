import { json } from "../../../_lib/response";
import { db, executions, runLogs } from "../../../_lib/db";
import { eq, asc } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/** GET /api/runs/:id/logs — returns log entries for the run. */
export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(executions).where(eq(executions.id, id));
  if (rows.length === 0) {
    return json({ error: "Not found" }, { status: 404 });
  }
  const logs = await db
    .select()
    .from(runLogs)
    .where(eq(runLogs.executionId, id))
    .orderBy(asc(runLogs.createdAt));
  const items = logs.map((r) => ({
    level: r.level,
    message: r.message,
    ...(r.payload ? { payload: JSON.parse(r.payload) as unknown } : {}),
  }));
  return json(items);
}

/** POST /api/runs/:id/logs — appends log entries to the run. */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(executions).where(eq(executions.id, id));
  if (rows.length === 0) {
    return json({ error: "Not found" }, { status: 404 });
  }
  let body: { logs?: Array<{ level: string; message: string; payload?: unknown }> };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const entries = body.logs;
  if (!Array.isArray(entries) || entries.length === 0) {
    return json({ error: "logs must be a non-empty array" }, { status: 400 });
  }
  const now = Date.now();
  for (const e of entries) {
    if (typeof e?.level !== "string" || typeof e?.message !== "string") {
      return json({ error: "Each log entry must have level and message" }, { status: 400 });
    }
  }
  for (const e of entries) {
    await db
      .insert(runLogs)
      .values({
        id: crypto.randomUUID(),
        executionId: id,
        level: e.level,
        message: e.message,
        payload: e.payload != null ? JSON.stringify(e.payload) : null,
        createdAt: now,
      })
      .run();
  }
  return json({ ok: true, count: entries.length }, { status: 201 });
}
