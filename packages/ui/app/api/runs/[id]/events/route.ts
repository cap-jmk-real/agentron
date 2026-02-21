import { json } from "../../../_lib/response";
import { db, executions } from "../../../_lib/db";
import { getExecutionEventsForRun, getExecutionRunState } from "../../../_lib/execution-events";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/**
 * GET /api/runs/:id/events
 * Returns the full execution event queue and optional run state for this run.
 * Use for diagnosis and "Copy for support" (events + state are JSON-serializable).
 */
export async function GET(_request: Request, { params }: Params) {
  const { id: runId } = await params;

  const rows = await db
    .select({ id: executions.id })
    .from(executions)
    .where(eq(executions.id, runId));
  if (rows.length === 0) {
    return json({ error: "Run not found" }, { status: 404 });
  }

  const [events, runState] = await Promise.all([
    getExecutionEventsForRun(runId),
    getExecutionRunState(runId),
  ]);

  const runStateForCopy = runState
    ? {
        executionId: runState.executionId,
        workflowId: runState.workflowId,
        targetBranchId: runState.targetBranchId,
        currentNodeId: runState.currentNodeId,
        round: runState.round,
        status: runState.status,
        waitingAtNodeId: runState.waitingAtNodeId,
        updatedAt: runState.updatedAt,
        sharedContextPreview:
          runState.sharedContext.length > 500
            ? runState.sharedContext.slice(0, 500) + "... [truncated]"
            : runState.sharedContext,
        trailSnapshotLength: runState.trailSnapshot?.length ?? 0,
      }
    : null;

  return json({
    runId,
    events,
    runState: runStateForCopy,
    /** Single string suitable for pasting into support/debug (copy for diagnosis). */
    copyForDiagnosis: JSON.stringify(
      { runId, events, runState: runStateForCopy, exportedAt: new Date().toISOString() },
      null,
      2
    ),
  });
}
