import { json } from "../../../_lib/response";
import { db, agents, agentVersions } from "../../../_lib/db";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/** POST /api/agents/:id/rollback - restore agent to a previous version. Body: { versionId: string } or { version: number }. */
export async function POST(request: Request, { params }: Params) {
  const { id: agentId } = await params;
  const body = await request.json().catch(() => ({}));
  const versionId = body.versionId as string | undefined;
  const versionNum = typeof body.version === "number" ? body.version : undefined;

  const agentRows = await db.select({ id: agents.id }).from(agents).where(eq(agents.id, agentId));
  if (agentRows.length === 0) {
    return json({ error: "Agent not found" }, { status: 404 });
  }

  let versionRow: { id: string; agentId: string; version: number; snapshot: string } | undefined;
  if (versionId) {
    const rows = await db
      .select()
      .from(agentVersions)
      .where(eq(agentVersions.id, versionId))
      .limit(1);
    versionRow =
      rows.length > 0 && rows[0].agentId === agentId
        ? (rows[0] as { id: string; agentId: string; version: number; snapshot: string })
        : undefined;
  } else if (versionNum != null) {
    const rows = await db.select().from(agentVersions).where(eq(agentVersions.agentId, agentId));
    versionRow = rows.find((r) => r.version === versionNum) as
      | { id: string; agentId: string; version: number; snapshot: string }
      | undefined;
  }
  if (!versionRow) {
    return json({ error: "Version not found (use versionId or version)" }, { status: 404 });
  }

  let snapshot: Record<string, unknown>;
  try {
    snapshot = JSON.parse(versionRow.snapshot) as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid snapshot" }, { status: 500 });
  }
  if (String(snapshot.id) !== agentId) {
    return json({ error: "Snapshot does not match agent" }, { status: 400 });
  }

  await db
    .update(agents)
    .set(snapshot as Record<string, unknown>)
    .where(eq(agents.id, agentId))
    .run();
  return json({ id: agentId, version: versionRow.version, message: "Agent rolled back" });
}
