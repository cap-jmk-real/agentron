import { json } from "../../../_lib/response";
import { db, executions, toExecutionRow } from "../../../_lib/db";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/** Creates a run record (queued). When agent execution is run (here or in a worker), on success/failure PATCH /api/runs/:runId with status ("completed" | "failed") and output (see executionOutputSuccess/executionOutputFailure in _lib/db). */
export async function POST(_: Request, { params }: Params) {
  const { id } = await params;
  const runId = crypto.randomUUID();
  const run = {
    id: runId,
    targetType: "agent",
    targetId: id,
    status: "queued",
  };
  await db.insert(executions).values(toExecutionRow(run)).run();
  return json({ id: runId, targetType: run.targetType, targetId: run.targetId, status: run.status }, { status: 202 });
}
