import { json } from "../../../_lib/response";
import { db, agents, agentVersions } from "../../../_lib/db";
import { eq, desc } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/** GET /api/agents/:id/versions - list version history for an agent. */
export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const agentRows = await db.select({ id: agents.id }).from(agents).where(eq(agents.id, id));
  if (agentRows.length === 0) {
    return json({ error: "Agent not found" }, { status: 404 });
  }
  const rows = await db
    .select({
      id: agentVersions.id,
      version: agentVersions.version,
      createdAt: agentVersions.createdAt,
    })
    .from(agentVersions)
    .where(eq(agentVersions.agentId, id))
    .orderBy(desc(agentVersions.version));
  return json(rows.map((r) => ({ id: r.id, version: r.version, created_at: r.createdAt })));
}
