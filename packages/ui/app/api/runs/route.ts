import { json } from "../_lib/response";
import { db, executions, workflows, agents, fromExecutionRow } from "../_lib/db";
import { desc, eq, inArray } from "drizzle-orm";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const targetType = searchParams.get("targetType") ?? undefined;
  const targetId = searchParams.get("targetId") ?? undefined;
  const limit = Math.min(Number(searchParams.get("limit")) || 50, 200);
  let rows = await db.select().from(executions).orderBy(desc(executions.startedAt));
  if (targetType) rows = rows.filter((r) => r.targetType === targetType);
  if (targetId) rows = rows.filter((r) => r.targetId === targetId);
  rows = rows.slice(0, limit);
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
