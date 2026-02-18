/**
 * Runs one scheduled workflow (creates execution row, runs workflow, updates on completion/failure).
 * Extracted so workflow-queue worker can call it without circular dependency.
 */
import { eq } from "drizzle-orm";
import { runWorkflow } from "./run-workflow";
import { db, executions, toExecutionRow, executionOutputSuccess, executionOutputFailure } from "./db";
import { getWorkflowMaxSelfFixRetries } from "./app-settings";
import { createRunNotification } from "./notifications-store";
import { withContainerInstallHint } from "./container-manager";
import { RUN_CANCELLED_MESSAGE, WAITING_FOR_USER_MESSAGE } from "./run-workflow";

export async function runOneScheduledWorkflow(workflowId: string, branchId?: string): Promise<void> {
  const runId = crypto.randomUUID();
  await db
    .insert(executions)
    .values(
      toExecutionRow({
        id: runId,
        targetType: "workflow",
        targetId: workflowId,
        targetBranchId: branchId ?? null,
        status: "running",
      })
    )
    .run();

  try {
    const onStepComplete = async (
      trail: Array<{ order: number; round?: number; nodeId: string; agentName: string; input?: unknown; output?: unknown; error?: string }>,
      lastOutput: unknown
    ) => {
      const payload = executionOutputSuccess(lastOutput ?? undefined, trail);
      await db.update(executions).set({ output: JSON.stringify(payload) }).where(eq(executions.id, runId)).run();
    };
    const onProgress = async (
      state: { message: string; toolId?: string },
      currentTrail: Array<{ order: number; round?: number; nodeId: string; agentName: string; input?: unknown; output?: unknown; error?: string }>
    ) => {
      const payload = executionOutputSuccess(undefined, currentTrail.length > 0 ? currentTrail : undefined, state.message);
      await db.update(executions).set({ output: JSON.stringify(payload) }).where(eq(executions.id, runId)).run();
    };
    const isCancelled = async () => {
      const rows = await db.select({ status: executions.status }).from(executions).where(eq(executions.id, runId));
      return rows[0]?.status === "cancelled";
    };
    const { output, context, trail } = await runWorkflow({
      workflowId,
      runId,
      branchId,
      onStepComplete,
      onProgress,
      isCancelled,
      maxSelfFixRetries: getWorkflowMaxSelfFixRetries(),
    });
    const payload = executionOutputSuccess(output ?? context, trail);
    await db.update(executions).set({ status: "completed", finishedAt: Date.now(), output: JSON.stringify(payload) }).where(eq(executions.id, runId)).run();
    try {
      createRunNotification(runId, "completed", { targetType: "workflow", targetId: workflowId });
    } catch {
      // ignore
    }
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    if (rawMessage === WAITING_FOR_USER_MESSAGE) return;
    if (rawMessage === RUN_CANCELLED_MESSAGE) {
      await db.update(executions).set({ status: "cancelled", finishedAt: Date.now() }).where(eq(executions.id, runId)).run();
      return;
    }
    const message = withContainerInstallHint(rawMessage);
    const payload = executionOutputFailure(message, { message, stack: err instanceof Error ? err.stack : undefined });
    await db.update(executions).set({ status: "failed", finishedAt: Date.now(), output: JSON.stringify(payload) }).where(eq(executions.id, runId)).run();
    try {
      createRunNotification(runId, "failed", { targetType: "workflow", targetId: workflowId });
    } catch {
      // ignore
    }
  }
}
