import { json } from "../../../_lib/response";
import { db, workflows, workflowVersions } from "../../../_lib/db";
import { refreshScheduledWorkflows } from "../../../_lib/scheduled-workflows";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/** POST /api/workflows/:id/rollback - restore workflow to a previous version. Body: { versionId: string } or { version: number }. */
export async function POST(request: Request, { params }: Params) {
  const { id: workflowId } = await params;
  const body = await request.json().catch(() => ({}));
  const versionId = body.versionId as string | undefined;
  const versionNum = typeof body.version === "number" ? body.version : undefined;

  const wfRows = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(eq(workflows.id, workflowId));
  if (wfRows.length === 0) {
    return json({ error: "Workflow not found" }, { status: 404 });
  }

  let versionRow: { id: string; workflowId: string; version: number; snapshot: string } | undefined;
  if (versionId) {
    const rows = await db
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.id, versionId))
      .limit(1);
    versionRow =
      rows.length > 0 && rows[0].workflowId === workflowId
        ? (rows[0] as { id: string; workflowId: string; version: number; snapshot: string })
        : undefined;
  } else if (versionNum != null) {
    const rows = await db
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.workflowId, workflowId));
    versionRow = rows.find((r) => r.version === versionNum) as
      | { id: string; workflowId: string; version: number; snapshot: string }
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
  if (String(snapshot.id) !== workflowId) {
    return json({ error: "Snapshot does not match workflow" }, { status: 400 });
  }

  await db
    .update(workflows)
    .set(snapshot as Record<string, unknown>)
    .where(eq(workflows.id, workflowId))
    .run();
  refreshScheduledWorkflows();
  return json({ id: workflowId, version: versionRow.version, message: "Workflow rolled back" });
}
