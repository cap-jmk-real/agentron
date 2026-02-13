import { json } from "../_lib/response";
import { db, workflows as workflowsTable, toWorkflowRow, fromWorkflowRow } from "../_lib/db";
import { randomWorkflowName } from "../_lib/naming";
import { refreshScheduledWorkflows } from "../_lib/scheduled-workflows";

export const runtime = "nodejs";

export async function GET() {
  const rows = await db.select().from(workflowsTable);
  return json(rows.map(fromWorkflowRow));
}

export async function POST(request: Request) {
  const payload = await request.json();
  const id = payload.id ?? crypto.randomUUID();
  const name = (payload.name && String(payload.name).trim()) ? payload.name : randomWorkflowName();
  const workflow = { ...payload, id, name };
  await db.insert(workflowsTable).values(toWorkflowRow(workflow)).run();
  refreshScheduledWorkflows();
  return json(workflow, { status: 201 });
}
