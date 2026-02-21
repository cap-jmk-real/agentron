import { json } from "../../_lib/response";
import { db, executions, runLogs, workflows, agents, fromExecutionRow } from "../../_lib/db";
import { createRunNotification } from "../../_lib/notifications-store";
import { eq, asc } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(executions).where(eq(executions.id, id));
  if (rows.length === 0) {
    return json({ error: "Not found" }, { status: 404 });
  }
  const run = fromExecutionRow(rows[0]);
  let targetName: string | undefined;
  if (run.targetType === "workflow") {
    const wf = await db
      .select({ name: workflows.name })
      .from(workflows)
      .where(eq(workflows.id, run.targetId));
    targetName = wf[0]?.name;
  } else if (run.targetType === "agent") {
    const ag = await db
      .select({ name: agents.name })
      .from(agents)
      .where(eq(agents.id, run.targetId));
    targetName = ag[0]?.name;
  }
  const logRows = await db
    .select({
      level: runLogs.level,
      message: runLogs.message,
      payload: runLogs.payload,
      createdAt: runLogs.createdAt,
    })
    .from(runLogs)
    .where(eq(runLogs.executionId, id))
    .orderBy(asc(runLogs.createdAt));
  const logs = logRows.map((r) => ({
    level: r.level,
    message: r.message,
    payload: r.payload,
    createdAt: r.createdAt,
  }));
  return json({ ...run, targetName, logs });
}

/** Update run status and output (e.g. after execution completes or fails). */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(executions).where(eq(executions.id, id));
  if (rows.length === 0) {
    return json({ error: "Not found" }, { status: 404 });
  }
  let body: { status?: string; output?: unknown; finishedAt?: number | null };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const updates: Record<string, unknown> = {};
  if (body.status !== undefined) updates.status = body.status;
  if (body.finishedAt !== undefined) updates.finishedAt = body.finishedAt;
  if (body.output !== undefined)
    updates.output = body.output == null ? null : JSON.stringify(body.output);
  if (Object.keys(updates).length === 0) {
    return json(fromExecutionRow(rows[0]));
  }
  await db
    .update(executions)
    .set(updates as Record<string, unknown>)
    .where(eq(executions.id, id))
    .run();
  const runStatus = body.status as string | undefined;
  if (runStatus === "completed" || runStatus === "failed" || runStatus === "waiting_for_user") {
    const row = rows[0];
    try {
      await createRunNotification(id, runStatus, {
        targetType: row.targetType,
        targetId: row.targetId,
      });
    } catch {
      // ignore notification errors
    }
  }
  const updated = await db.select().from(executions).where(eq(executions.id, id));
  return json(fromExecutionRow(updated[0]));
}
