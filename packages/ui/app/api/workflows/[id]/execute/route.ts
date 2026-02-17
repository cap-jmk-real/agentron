import { json } from "../../../_lib/response";
import { db, executions, runLogs, toExecutionRow, fromExecutionRow } from "../../../_lib/db";
import { executionOutputSuccess, executionOutputFailure } from "../../../_lib/db";
import { runWorkflow, RUN_CANCELLED_MESSAGE, WAITING_FOR_USER_MESSAGE, WaitingForUserError } from "../../../_lib/run-workflow";
import { withContainerInstallHint } from "../../../_lib/container-manager";
import { enqueueWorkflowRun } from "../../../_lib/workflow-queue";
import { getAppSettings } from "../../../_lib/app-settings";
import { getVaultKeyFromRequest } from "../../../_lib/vault";
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

  const vaultKey = getVaultKeyFromRequest(request);
  // #region agent log
  if (vaultKey) fetch('http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'workflows/[id]/execute/route.ts',message:'workflow start with vault',data:{runId,hasVaultKey:true},hypothesisId:'vault_access',timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  try {
    await enqueueWorkflowRun(async () => {
      const onStepComplete = async (trail: Array<{ order: number; round?: number; nodeId: string; agentName: string; input?: unknown; output?: unknown; error?: string }>, lastOutput: unknown) => {
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
      const { output, context, trail } = await runWorkflow({ workflowId, runId, vaultKey: vaultKey ?? undefined, onStepComplete, onProgress, isCancelled, onContainerStream, maxSelfFixRetries });
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
      if (err instanceof WaitingForUserError && err.trail.length > 0) {
        try {
          const runRows = await db.select({ output: executions.output }).from(executions).where(eq(executions.id, runId));
          const raw = runRows[0]?.output;
          const parsed = raw == null ? {} : (typeof raw === "string" ? JSON.parse(raw) as Record<string, unknown> : raw as Record<string, unknown>);
          await db.update(executions).set({ output: JSON.stringify({ ...parsed, trail: err.trail }) }).where(eq(executions.id, runId)).run();
        } catch {
          // ignore
        }
      }
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
