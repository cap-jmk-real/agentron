import { json } from "../../_lib/response";
import { db, workflows as workflowsTable, toWorkflowRow, fromWorkflowRow } from "../../_lib/db";
import { refreshScheduledWorkflows } from "../../_lib/scheduled-workflows";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(workflowsTable).where(eq(workflowsTable.id, id));
  if (rows.length === 0) {
    return json({ error: "Not found" }, { status: 404 });
  }
  return json(fromWorkflowRow(rows[0]));
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const payload = await request.json();
  const workflow = { ...payload, id };
  await db
    .update(workflowsTable)
    .set(toWorkflowRow(workflow))
    .where(eq(workflowsTable.id, id))
    .run();
  refreshScheduledWorkflows();
  return json(workflow);
}

export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params;
  await db.delete(workflowsTable).where(eq(workflowsTable.id, id)).run();
  refreshScheduledWorkflows();
  return json({ ok: true });
}
