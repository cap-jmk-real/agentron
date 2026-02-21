import { json } from "../../_lib/response";
import { db, tokenUsage, agents, fromAgentRow } from "../../_lib/db";

export const runtime = "nodejs";

export async function GET() {
  const allAgents = (await db.select().from(agents)).map(fromAgentRow);
  const allUsage = await db.select().from(tokenUsage);

  const agentStats = allAgents.map((agent) => {
    const rows = allUsage.filter((r) => r.agentId === agent.id);
    const totalPrompt = rows.reduce((s, r) => s + r.promptTokens, 0);
    const totalCompletion = rows.reduce((s, r) => s + r.completionTokens, 0);
    const totalCost = rows.reduce(
      (s, r) => s + (r.estimatedCost ? parseFloat(r.estimatedCost) : 0),
      0
    );
    const lastRun = rows.length > 0 ? Math.max(...rows.map((r) => r.createdAt)) : null;

    return {
      id: agent.id,
      name: agent.name,
      totalRuns: rows.length,
      promptTokens: totalPrompt,
      completionTokens: totalCompletion,
      totalTokens: totalPrompt + totalCompletion,
      estimatedCost: Math.round(totalCost * 1_000_000) / 1_000_000,
      lastRun,
    };
  });

  // Also include chat usage (not tied to a specific agent)
  const chatRows = allUsage.filter((r) => !r.agentId && !r.workflowId);
  const chatPrompt = chatRows.reduce((s, r) => s + r.promptTokens, 0);
  const chatCompletion = chatRows.reduce((s, r) => s + r.completionTokens, 0);
  const chatCost = chatRows.reduce(
    (s, r) => s + (r.estimatedCost ? parseFloat(r.estimatedCost) : 0),
    0
  );

  const totals = {
    totalRuns: allUsage.length,
    promptTokens: allUsage.reduce((s, r) => s + r.promptTokens, 0),
    completionTokens: allUsage.reduce((s, r) => s + r.completionTokens, 0),
    totalTokens: allUsage.reduce((s, r) => s + r.promptTokens + r.completionTokens, 0),
    estimatedCost:
      Math.round(
        allUsage.reduce((s, r) => s + (r.estimatedCost ? parseFloat(r.estimatedCost) : 0), 0) *
          1_000_000
      ) / 1_000_000,
  };

  return json({
    agents: agentStats.sort((a, b) => b.totalTokens - a.totalTokens),
    chat: {
      totalRuns: chatRows.length,
      promptTokens: chatPrompt,
      completionTokens: chatCompletion,
      totalTokens: chatPrompt + chatCompletion,
      estimatedCost: Math.round(chatCost * 1_000_000) / 1_000_000,
    },
    totals,
  });
}
