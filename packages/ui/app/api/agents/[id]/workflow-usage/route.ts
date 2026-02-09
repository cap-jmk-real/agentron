import { json } from "../../../_lib/response";
import { db, workflows } from "../../../_lib/db";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/** Returns workflows that reference this agent (e.g. nodes with config.agentId or config.agent_id). */
export async function GET(_: Request, { params }: Params) {
  const { id: agentId } = await params;
  if (!agentId) {
    return json({ error: "Missing agent id" }, { status: 400 });
  }

  const rows = await db.select({ id: workflows.id, name: workflows.name, nodes: workflows.nodes }).from(workflows);
  const usedBy: { id: string; name: string }[] = [];

  for (const row of rows) {
    let nodes: Array<{ config?: Record<string, unknown> }>;
    try {
      nodes = typeof row.nodes === "string" ? JSON.parse(row.nodes) : Array.isArray(row.nodes) ? row.nodes : [];
    } catch {
      continue;
    }
    if (!Array.isArray(nodes)) continue;
    const referencesAgent = nodes.some((node) => {
      const c = node?.config;
      if (!c || typeof c !== "object") return false;
      const id = (c as Record<string, unknown>).agentId ?? (c as Record<string, unknown>).agent_id;
      return id === agentId;
    });
    if (referencesAgent) {
      usedBy.push({ id: row.id, name: row.name ?? row.id });
    }
  }

  return json({ workflows: usedBy });
}
