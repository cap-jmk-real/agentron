import { json } from "../../../_lib/response";
import { db, tokenUsage, agents, fromAgentRow } from "../../../_lib/db";
import { eq } from "drizzle-orm";

type Params = { params: { id: string } };

export const runtime = "nodejs";

export async function GET(_: Request, { params }: Params) {
  const agentRows = await db.select().from(agents).where(eq(agents.id, params.id));
  if (agentRows.length === 0) return json({ error: "Agent not found" }, { status: 404 });
  const agent = fromAgentRow(agentRows[0]);

  const rows = (await db.select().from(tokenUsage)).filter((r) => r.agentId === params.id);

  const totalPrompt = rows.reduce((s, r) => s + r.promptTokens, 0);
  const totalCompletion = rows.reduce((s, r) => s + r.completionTokens, 0);
  const totalCost = rows.reduce((s, r) => s + (r.estimatedCost ? parseFloat(r.estimatedCost) : 0), 0);

  // Group by day for time series
  const byDay: Record<string, { promptTokens: number; completionTokens: number; cost: number; count: number }> = {};
  for (const r of rows) {
    const day = new Date(r.createdAt).toISOString().slice(0, 10);
    if (!byDay[day]) byDay[day] = { promptTokens: 0, completionTokens: 0, cost: 0, count: 0 };
    byDay[day].promptTokens += r.promptTokens;
    byDay[day].completionTokens += r.completionTokens;
    byDay[day].cost += r.estimatedCost ? parseFloat(r.estimatedCost) : 0;
    byDay[day].count++;
  }

  const timeSeries = Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({ date, ...data }));

  // Per-run breakdown (recent 50)
  const runs = rows
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50)
    .map((r) => ({
      id: r.id,
      provider: r.provider,
      model: r.model,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      estimatedCost: r.estimatedCost ? parseFloat(r.estimatedCost) : 0,
      createdAt: r.createdAt,
    }));

  return json({
    agent: { id: agent.id, name: agent.name },
    summary: {
      totalRuns: rows.length,
      promptTokens: totalPrompt,
      completionTokens: totalCompletion,
      totalTokens: totalPrompt + totalCompletion,
      estimatedCost: Math.round(totalCost * 1_000_000) / 1_000_000,
    },
    timeSeries,
    runs,
  });
}
