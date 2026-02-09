import { json } from "../../_lib/response";
import { db, executions, workflows, agents, fromExecutionRow } from "../../_lib/db";
import { eq } from "drizzle-orm";

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
    const wf = await db.select({ name: workflows.name }).from(workflows).where(eq(workflows.id, run.targetId));
    targetName = wf[0]?.name;
  } else if (run.targetType === "agent") {
    const ag = await db.select({ name: agents.name }).from(agents).where(eq(agents.id, run.targetId));
    targetName = ag[0]?.name;
  }
  return json({ ...run, targetName });
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
  if (body.output !== undefined) updates.output = body.output == null ? null : JSON.stringify(body.output);
  if (Object.keys(updates).length === 0) {
    return json(fromExecutionRow(rows[0]));
  }
  await db.update(executions).set(updates as Record<string, unknown>).where(eq(executions.id, id)).run();
  const updated = await db.select().from(executions).where(eq(executions.id, id));
  return json(fromExecutionRow(updated[0]));
}
