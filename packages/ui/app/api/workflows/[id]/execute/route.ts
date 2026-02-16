import { json } from "../../../_lib/response";
import { db, executions, runLogs, toExecutionRow, fromExecutionRow } from "../../../_lib/db";
import { executionOutputSuccess, executionOutputFailure } from "../../../_lib/db";
import { runWorkflow, RUN_CANCELLED_MESSAGE, WAITING_FOR_USER_MESSAGE } from "../../../_lib/run-workflow";
import { withContainerInstallHint } from "../../../_lib/container-manager";
import { enqueueWorkflowRun } from "../../../_lib/workflow-queue";
import { getAppSettings } from "../../../_lib/app-settings";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/** Starts a workflow run, executes it synchronously, and updates the run with output or error. Optional body: { maxSelfFixRetries?: number }. */
export async function POST(request: Request, { params }: Params) {
  const { id: workflowId } = await params;
  let maxSelfFixRetries: number | undefined;
  try {
    const body = await request.json().catch(() => ({}));
    if (body && typeof body === "object" && typeof (body as { maxSelfFixRetries?: unknown }).maxSelfFixRetries === "number") {
      const v = (body as { maxSelfFixRetries: number }).maxSelfFixRetries;
      if (!Number.isNaN(v)) maxSelfFixRetries = Math.max(0, Math.min(10, Math.floor(v)));
    }
  } catch {
    // no body or invalid JSON
  }
  if (maxSelfFixRetries === undefined) {
    maxSelfFixRetries = getAppSettings().workflowMaxSelfFixRetries;
  }
  const runId = crypto.randomUUID();
  const run = {
    id: runId,
    targetType: "workflow",
    targetId: workflowId,
    status: "running",
  };
  await db.insert(executions).values(toExecutionRow(run)).run();

  try {
    await enqueueWorkflowRun(async () => {
      const onStepComplete = async (trail: Array<{ order: number; round?: number; nodeId: string; agentName: string; input?: unknown; output?: unknown; error?: string }>, lastOutput: unknown) => {
        const payload = executionOutputSuccess(lastOutput ?? undefined, trail);
        await db.update(executions).set({ output: JSON.stringify(payload) }).where(eq(executions.id, runId)).run();
      };
      const isCancelled = async () => {
        const rows = await db.select({ status: executions.status }).from(executions).where(eq(executions.id, runId));
        return rows[0]?.status === "cancelled";
      };
      const onContainerStream = (executionId: string, chunk: { stdout?: string; stderr?: string; meta?: string }) => {
        if (chunk.stdout) {
          void db.insert(runLogs).values({
            id: crypto.randomUUID(),
            executionId,
            level: "stdout",
            message: chunk.stdout,
            payload: null,
            createdAt: Date.now(),
          }).run();
        }
        if (chunk.stderr) {
          void db.insert(runLogs).values({
            id: crypto.randomUUID(),
            executionId,
            level: "stderr",
            message: chunk.stderr,
            payload: null,
            createdAt: Date.now(),
          }).run();
        }
        if (chunk.meta) {
          void db.insert(runLogs).values({
            id: crypto.randomUUID(),
            executionId,
            level: "meta",
            message: chunk.meta,
            payload: null,
            createdAt: Date.now(),
          }).run();
        }
      };
      const { output, context, trail } = await runWorkflow({ workflowId, runId, onStepComplete, isCancelled, onContainerStream, maxSelfFixRetries });
      const payload = executionOutputSuccess(output ?? context, trail);
      await db.update(executions).set({
        status: "completed",
        finishedAt: Date.now(),
        output: JSON.stringify(payload),
      }).where(eq(executions.id, runId)).run();
    });
    const updated = await db.select().from(executions).where(eq(executions.id, runId));
    return json(fromExecutionRow(updated[0]), { status: 200 });
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    if (rawMessage === WAITING_FOR_USER_MESSAGE) {
      const updated = await db.select().from(executions).where(eq(executions.id, runId));
      return json(fromExecutionRow(updated[0]), { status: 200 });
    }
    const cancelled = rawMessage === RUN_CANCELLED_MESSAGE;
    if (cancelled) {
      await db.update(executions).set({ status: "cancelled", finishedAt: Date.now() }).where(eq(executions.id, runId)).run();
    } else {
      const message = withContainerInstallHint(rawMessage);
      const payload = executionOutputFailure(message, { message, stack: err instanceof Error ? err.stack : undefined });
      await db.update(executions).set({
        status: "failed",
        finishedAt: Date.now(),
        output: JSON.stringify(payload),
      }).where(eq(executions.id, runId)).run();
    }
    const updated = await db.select().from(executions).where(eq(executions.id, runId));
    return json(fromExecutionRow(updated[0]), { status: 200 });
  }
}
