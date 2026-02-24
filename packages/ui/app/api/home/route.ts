import { json } from "../_lib/response";
import { db, tokenUsage, workflows, tasks, agents, fromWorkflowRow, fromTaskRow } from "../_lib/db";
import { eq, desc, inArray } from "drizzle-orm";

export const runtime = "nodejs";

/** GET /api/home — workflows + pending tasks in one request for faster initial load. */
export async function GET() {
  const [allWorkflows, allUsage, taskRows] = await Promise.all([
    db.select().from(workflows),
    db.select().from(tokenUsage),
    db
      .select()
      .from(tasks)
      .where(eq(tasks.status, "pending_approval"))
      .orderBy(desc(tasks.createdAt)),
  ]);

  const workflowList = allWorkflows.map(fromWorkflowRow);
  const workflowStats = workflowList.map((wf) => {
    const rows = allUsage.filter((r) => r.workflowId === wf.id);
    const totalPrompt = rows.reduce((s, r) => s + r.promptTokens, 0);
    const totalCompletion = rows.reduce((s, r) => s + r.completionTokens, 0);
    const totalCost = rows.reduce(
      (s, r) => s + (r.estimatedCost ? parseFloat(r.estimatedCost) : 0),
      0
    );
    const agentIds = new Set(rows.map((r) => r.agentId).filter(Boolean));
    const llmKeys = new Set(rows.map((r) => `${r.provider}:${r.model}`));
    return {
      id: wf.id,
      name: wf.name,
      totalRuns: rows.length,
      agentCount: agentIds.size,
      llmCount: llmKeys.size,
      promptTokens: totalPrompt,
      completionTokens: totalCompletion,
      totalTokens: totalPrompt + totalCompletion,
      estimatedCost: Math.round(totalCost * 1_000_000) / 1_000_000,
    };
  });

  const taskList = taskRows.map(fromTaskRow);
  const agentsMap: Record<string, { name: string }> = {};
  const workflowsMap: Record<string, { name: string }> = {};
  if (taskList.length > 0) {
    const agentIds = [...new Set(taskList.map((t) => t.agentId))];
    const workflowIds = [...new Set(taskList.map((t) => t.workflowId))];
    const [agentRows, workflowRows] = await Promise.all([
      db.select().from(agents).where(inArray(agents.id, agentIds)),
      db.select().from(workflows).where(inArray(workflows.id, workflowIds)),
    ]);
    for (const a of agentRows) agentsMap[a.id] = { name: a.name };
    for (const w of workflowRows) workflowsMap[w.id] = { name: w.name };
  }

  return json({
    workflows: workflowStats.sort((a, b) => b.totalTokens - a.totalTokens),
    tasks: taskList,
    agents: agentsMap,
    workflowsMap,
  });
}
