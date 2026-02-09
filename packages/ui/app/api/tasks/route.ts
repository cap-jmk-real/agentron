import { json } from "../_lib/response";
import { db, tasks, agents, workflows, fromTaskRow, toTaskRow } from "../_lib/db";
import { eq, desc, inArray } from "drizzle-orm";

export const runtime = "nodejs";

/** GET ?status=pending_approval (default) - list tasks needing approval, with workflow and agent names */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "pending_approval";
  const rows = await db.select().from(tasks).where(eq(tasks.status, status)).orderBy(desc(tasks.createdAt));
  const taskList = rows.map(fromTaskRow);
  const agentsMap: Record<string, { name: string }> = {};
  const workflowsMap: Record<string, { name: string }> = {};
  if (taskList.length > 0) {
    const agentIds = [...new Set(taskList.map((t) => t.agentId))];
    const workflowIds = [...new Set(taskList.map((t) => t.workflowId))];
    const agentRows = await db.select().from(agents).where(inArray(agents.id, agentIds));
    const workflowRows = await db.select().from(workflows).where(inArray(workflows.id, workflowIds));
    for (const a of agentRows) agentsMap[a.id] = { name: a.name };
    for (const w of workflowRows) workflowsMap[w.id] = { name: w.name };
  }
  return json({ tasks: taskList, agents: agentsMap, workflows: workflowsMap });
}

/** POST - create a task (e.g. when workflow runner hits an approval step) */
export async function POST(request: Request) {
  const body = await request.json();
  const id = body.id ?? crypto.randomUUID();
  const task = {
    id,
    workflowId: body.workflowId,
    executionId: body.executionId,
    agentId: body.agentId,
    stepId: body.stepId,
    stepName: body.stepName,
    label: body.label,
    status: "pending_approval" as const,
    input: body.input,
    output: undefined,
    createdAt: Date.now(),
    resolvedAt: undefined,
    resolvedBy: undefined,
  };
  await db.insert(tasks).values(toTaskRow(task)).run();
  return json(task, { status: 201 });
}
