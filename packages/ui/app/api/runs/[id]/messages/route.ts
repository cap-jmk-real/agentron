import { json } from "../../../_lib/response";
import { db, executions, getWorkflowMessages } from "../../../_lib/db";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/** GET /api/runs/:id/messages — workflow/execution messages for this run (for Agentron and UI). */
export async function GET(request: Request, { params }: Params) {
  const { id: runId } = await params;
  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit =
    limitParam != null ? Math.min(100, Math.max(1, parseInt(limitParam, 10) || 50)) : undefined;

  const rows = await db
    .select({ id: executions.id })
    .from(executions)
    .where(eq(executions.id, runId));
  if (rows.length === 0) {
    return json({ error: "Run not found" }, { status: 404 });
  }

  const messages = await getWorkflowMessages(runId, limit);
  return json({ runId, messages });
}
