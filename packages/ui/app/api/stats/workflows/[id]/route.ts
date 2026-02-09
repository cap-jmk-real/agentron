import { json } from "../../../_lib/response";
import { db, tokenUsage, workflows, agents, fromWorkflowRow, fromAgentRow } from "../../../_lib/db";
import { eq } from "drizzle-orm";

type Params = { params: { id: string } };

export const runtime = "nodejs";

export async function GET(_: Request, { params }: Params) {
  const wfRows = await db.select().from(workflows).where(eq(workflows.id, params.id));
  if (wfRows.length === 0) return json({ error: "Workflow not found" }, { status: 404 });
  const wf = fromWorkflowRow(wfRows[0]);

  const rows = (await db.select().from(tokenUsage)).filter((r) => r.workflowId === params.id);
  const allAgents = (await db.select().from(agents)).map(fromAgentRow);
  const agentMap = new Map(allAgents.map((a) => [a.id, a]));

  // Per-agent breakdown within this workflow
  const byAgent: Record<string, { name: string; promptTokens: number; completionTokens: number; cost: number; count: number }> = {};
  for (const r of rows) {
    const aid = r.agentId ?? "unknown";
    if (!byAgent[aid]) {
      const agent = agentMap.get(aid);
      byAgent[aid] = { name: agent?.name ?? "Unknown", promptTokens: 0, completionTokens: 0, cost: 0, count: 0 };
    }
    byAgent[aid].promptTokens += r.promptTokens;
    byAgent[aid].completionTokens += r.completionTokens;
    byAgent[aid].cost += r.estimatedCost ? parseFloat(r.estimatedCost) : 0;
    byAgent[aid].count++;
  }

  const totalPrompt = rows.reduce((s, r) => s + r.promptTokens, 0);
  const totalCompletion = rows.reduce((s, r) => s + r.completionTokens, 0);
  const totalCost = rows.reduce((s, r) => s + (r.estimatedCost ? parseFloat(r.estimatedCost) : 0), 0);

  return json({
    workflow: { id: wf.id, name: wf.name },
    summary: {
      totalRuns: rows.length,
      promptTokens: totalPrompt,
      completionTokens: totalCompletion,
      totalTokens: totalPrompt + totalCompletion,
      estimatedCost: Math.round(totalCost * 1_000_000) / 1_000_000,
    },
    agents: Object.entries(byAgent).map(([id, data]) => ({
      id,
      ...data,
      estimatedCost: Math.round(data.cost * 1_000_000) / 1_000_000,
    })).sort((a, b) => (b.promptTokens + b.completionTokens) - (a.promptTokens + a.completionTokens)),
  });
}
