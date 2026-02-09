import { json } from "../../_lib/response";
import { db, tokenUsage, workflows, fromWorkflowRow } from "../../_lib/db";

export const runtime = "nodejs";

export async function GET() {
  const allWorkflows = (await db.select().from(workflows)).map(fromWorkflowRow);
  const allUsage = await db.select().from(tokenUsage);

  const workflowStats = allWorkflows.map((wf) => {
    const rows = allUsage.filter((r) => r.workflowId === wf.id);
    const totalPrompt = rows.reduce((s, r) => s + r.promptTokens, 0);
    const totalCompletion = rows.reduce((s, r) => s + r.completionTokens, 0);
    const totalCost = rows.reduce((s, r) => s + (r.estimatedCost ? parseFloat(r.estimatedCost) : 0), 0);
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

  return json({ workflows: workflowStats.sort((a, b) => b.totalTokens - a.totalTokens) });
}
