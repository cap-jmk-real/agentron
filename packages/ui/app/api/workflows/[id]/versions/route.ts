import { json } from "../../../_lib/response";
import { db, workflows, workflowVersions } from "../../../_lib/db";
import { eq, desc } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/** GET /api/workflows/:id/versions - list version history for a workflow. */
export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const wfRows = await db.select({ id: workflows.id }).from(workflows).where(eq(workflows.id, id));
  if (wfRows.length === 0) {
    return json({ error: "Workflow not found" }, { status: 404 });
  }
  const rows = await db
    .select({
      id: workflowVersions.id,
      version: workflowVersions.version,
      createdAt: workflowVersions.createdAt,
    })
    .from(workflowVersions)
    .where(eq(workflowVersions.workflowId, id))
    .orderBy(desc(workflowVersions.version));
  return json(rows.map((r) => ({ id: r.id, version: r.version, created_at: r.createdAt })));
}
