import { json } from "../_lib/response";
import { db, executions, workflows, agents, fromExecutionRow } from "../_lib/db";
import { desc, eq, inArray } from "drizzle-orm";

export const runtime = "nodejs";

export async function GET() {
  const rows = await db.select().from(executions).orderBy(desc(executions.startedAt));
  const runs = rows.map(fromExecutionRow);
  const workflowIds = [...new Set(runs.filter((r) => r.targetType === "workflow").map((r) => r.targetId))];
  const agentIds = [...new Set(runs.filter((r) => r.targetType === "agent").map((r) => r.targetId))];
  const workflowMap: Record<string, string> = {};
  const agentMap: Record<string, string> = {};
  if (workflowIds.length > 0) {
    const wfRows = await db
      .select({ id: workflows.id, name: workflows.name })
      .from(workflows)
      .where(inArray(workflows.id, workflowIds));
    for (const w of wfRows) workflowMap[w.id] = w.name ?? "";
  }
  if (agentIds.length > 0) {
    const agRows = await db
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(inArray(agents.id, agentIds));
    for (const a of agRows) agentMap[a.id] = a.name ?? "";
  }
  const enriched = runs.map((r) => ({
    ...r,
    targetName: r.targetType === "workflow" ? workflowMap[r.targetId] : r.targetType === "agent" ? agentMap[r.targetId] : undefined,
  }));
  return json(enriched);
}
