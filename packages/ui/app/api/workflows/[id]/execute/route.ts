import { json } from "../../../_lib/response";
import { db, executions, toExecutionRow, fromExecutionRow } from "../../../_lib/db";
import { executionOutputSuccess, executionOutputFailure } from "../../../_lib/db";
import { runWorkflow } from "../../../_lib/run-workflow";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/** Starts a workflow run, executes it synchronously, and updates the run with output or error. */
export async function POST(_: Request, { params }: Params) {
  const { id: workflowId } = await params;
  const runId = crypto.randomUUID();
  const run = {
    id: runId,
    targetType: "workflow",
    targetId: workflowId,
    status: "running",
  };
  await db.insert(executions).values(toExecutionRow(run)).run();

  try {
    const { output, context, trail } = await runWorkflow({ workflowId, runId });
    const payload = executionOutputSuccess(output ?? context, trail);
    await db.update(executions).set({
      status: "completed",
      finishedAt: Date.now(),
      output: JSON.stringify(payload),
    }).where(eq(executions.id, runId)).run();
    const updated = await db.select().from(executions).where(eq(executions.id, runId));
    return json(fromExecutionRow(updated[0]), { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const payload = executionOutputFailure(message, { message, stack: err instanceof Error ? err.stack : undefined });
    await db.update(executions).set({
      status: "failed",
      finishedAt: Date.now(),
      output: JSON.stringify(payload),
    }).where(eq(executions.id, runId)).run();
    const updated = await db.select().from(executions).where(eq(executions.id, runId));
    return json(fromExecutionRow(updated[0]), { status: 200 });
  }
}
