/**
 * Runs a workflow and returns its output (or throws). Caller is responsible for
 * updating the execution record with status and output.
 */
import { eq } from "drizzle-orm";
import { db, executions, runLogs, executionOutputSuccess, executionOutputFailure } from "./db";
import { withContainerInstallHint } from "./container-manager";
import { getWorkflowMaxSelfFixRetries } from "./app-settings";
import { createRunNotification } from "./notifications-store";
import { ensureRunFailureSideEffects } from "./run-failure-side-effects";
import { destroyContainerSession, type ContainerStreamChunk } from "./run-workflow-containers";
import {
  WAITING_FOR_USER_MESSAGE,
  RUN_CANCELLED_MESSAGE,
  WaitingForUserError,
  type ExecutionTraceStep,
} from "./run-workflow-constants";
import { runWorkflow, type RunWorkflowOptions } from "./run-workflow-engine";

export {
  WAITING_FOR_USER_MESSAGE,
  RUN_CANCELLED_MESSAGE,
  WaitingForUserError,
  isToolResultFailure,
  type ExecutionTraceStep,
} from "./run-workflow-constants";
export type { ContainerStreamChunk } from "./run-workflow-containers";
export {
  runContainer,
  runContainerSession,
  runContainerBuild,
  runWriteFile,
} from "./run-workflow-containers";
export { runWorkflow };
export type { RunWorkflowOptions };

/**
 * Loads a run by id and executes its workflow (used for resume after user response).
 * Updates the run with output/status on completion, WAITING_FOR_USER, or failure.
 */
export async function runWorkflowForRun(
  runId: string,
  opts?: { resumeUserResponse?: string; vaultKey?: Buffer | null }
): Promise<void> {
  // #region agent log
  fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      location: "run-workflow.ts:runWorkflowForRun",
      message: "resume workflow invoked",
      data: {
        runId,
        resumeUserResponseLen: opts?.resumeUserResponse?.length ?? 0,
        hasVaultKey: !!opts?.vaultKey,
      },
      hypothesisId: "vault_access",
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  const rows = await db
    .select({ targetId: executions.targetId, targetBranchId: executions.targetBranchId })
    .from(executions)
    .where(eq(executions.id, runId));
  if (rows.length === 0) throw new Error("Run not found");
  const workflowId = rows[0].targetId;
  const branchId = (rows[0].targetBranchId as string | null) ?? undefined;

  const onStepComplete = async (trail: ExecutionTraceStep[], lastOutput: unknown) => {
    const runRows = await db
      .select({ output: executions.output })
      .from(executions)
      .where(eq(executions.id, runId));
    const current = runRows[0]?.output;
    const parsed =
      typeof current === "string"
        ? (() => {
            try {
              return JSON.parse(current) as Record<string, unknown>;
            } catch {
              return undefined;
            }
          })()
        : (current as Record<string, unknown> | null | undefined);
    const existingTrail = Array.isArray(parsed?.trail)
      ? (parsed.trail as ExecutionTraceStep[])
      : [];
    const mergedTrail = existingTrail.length > 0 ? [...existingTrail, ...trail] : trail;
    const payload = executionOutputSuccess(lastOutput ?? undefined, mergedTrail);
    await db
      .update(executions)
      .set({ output: JSON.stringify(payload) })
      .where(eq(executions.id, runId))
      .run();
  };
  const onProgress = async (
    state: { message: string; toolId?: string },
    currentTrail: ExecutionTraceStep[]
  ) => {
    const runRows = await db
      .select({ output: executions.output })
      .from(executions)
      .where(eq(executions.id, runId));
    const current = runRows[0]?.output;
    const parsed =
      typeof current === "string"
        ? (() => {
            try {
              return JSON.parse(current) as Record<string, unknown>;
            } catch {
              return undefined;
            }
          })()
        : (current as Record<string, unknown> | null | undefined);
    const existingTrail = Array.isArray(parsed?.trail)
      ? (parsed.trail as ExecutionTraceStep[])
      : [];
    const mergedTrail =
      currentTrail.length > 0 ? [...existingTrail, ...currentTrail] : existingTrail;
    const payload = executionOutputSuccess(
      undefined,
      mergedTrail.length > 0 ? mergedTrail : undefined,
      state.message
    );
    await db
      .update(executions)
      .set({ output: JSON.stringify(payload) })
      .where(eq(executions.id, runId))
      .run();
  };
  const isCancelled = async () => {
    const r = await db
      .select({ status: executions.status })
      .from(executions)
      .where(eq(executions.id, runId));
    return r[0]?.status === "cancelled";
  };
  const onContainerStream = (executionId: string, chunk: ContainerStreamChunk) => {
    if (chunk.stdout) {
      void db
        .insert(runLogs)
        .values({
          id: crypto.randomUUID(),
          executionId: executionId,
          level: "stdout",
          message: `[Container] ${chunk.stdout}`,
          payload: JSON.stringify({ source: "container" }),
          createdAt: Date.now(),
        })
        .run();
    }
    if (chunk.stderr) {
      void db
        .insert(runLogs)
        .values({
          id: crypto.randomUUID(),
          executionId,
          level: "stderr",
          message: `[Container] ${chunk.stderr}`,
          payload: JSON.stringify({ source: "container" }),
          createdAt: Date.now(),
        })
        .run();
    }
    if (chunk.meta) {
      void db
        .insert(runLogs)
        .values({
          id: crypto.randomUUID(),
          executionId,
          level: "meta",
          message: `[Container] ${chunk.meta}`,
          payload: JSON.stringify({ source: "container" }),
          createdAt: Date.now(),
        })
        .run();
    }
  };

  try {
    const { output, context, trail } = await runWorkflow({
      workflowId,
      runId,
      branchId,
      resumeUserResponse: opts?.resumeUserResponse,
      vaultKey: opts?.vaultKey ?? null,
      onStepComplete,
      onProgress,
      isCancelled,
      onContainerStream,
      maxSelfFixRetries: getWorkflowMaxSelfFixRetries(),
    });
    await destroyContainerSession(runId);
    const runRows = await db
      .select({ output: executions.output })
      .from(executions)
      .where(eq(executions.id, runId));
    const current = runRows[0]?.output;
    const parsed =
      typeof current === "string"
        ? (() => {
            try {
              return JSON.parse(current) as Record<string, unknown>;
            } catch {
              return undefined;
            }
          })()
        : (current as Record<string, unknown> | null | undefined);
    const existingTrail = Array.isArray(parsed?.trail)
      ? (parsed.trail as ExecutionTraceStep[])
      : [];
    const mergedTrail = existingTrail.length > 0 ? [...existingTrail, ...trail] : trail;
    const payload = executionOutputSuccess(output ?? context, mergedTrail);
    await db
      .update(executions)
      .set({
        status: "completed",
        finishedAt: Date.now(),
        output: JSON.stringify(payload),
      })
      .where(eq(executions.id, runId))
      .run();
    try {
      await createRunNotification(runId, "completed", {
        targetType: "workflow",
        targetId: workflowId,
      });
    } catch {
      // ignore
    }
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    if (rawMessage === WAITING_FOR_USER_MESSAGE || err instanceof WaitingForUserError) {
      if (err instanceof WaitingForUserError && err.trail.length > 0) {
        const runRows = await db
          .select({ output: executions.output })
          .from(executions)
          .where(eq(executions.id, runId));
        const current = runRows[0]?.output;
        const parsed =
          typeof current === "string"
            ? (() => {
                try {
                  return JSON.parse(current) as Record<string, unknown>;
                } catch {
                  return {};
                }
              })()
            : ((current as Record<string, unknown> | null) ?? {});
        // request_user_help already wrote the full trail (existing + current step) to the DB.
        // err.trail is only this run's in-memory steps; do not overwrite and lose prior steps.
        const existingTrail = Array.isArray(parsed?.trail)
          ? (parsed.trail as ExecutionTraceStep[])
          : [];
        const trailToSave = existingTrail.length > 0 ? existingTrail : err.trail;
        const merged = { ...parsed, trail: trailToSave };
        await db
          .update(executions)
          .set({ output: JSON.stringify(merged) })
          .where(eq(executions.id, runId))
          .run();
      }
      return;
    }
    await destroyContainerSession(runId);
    if (rawMessage === RUN_CANCELLED_MESSAGE) {
      await db
        .update(executions)
        .set({ status: "cancelled", finishedAt: Date.now() })
        .where(eq(executions.id, runId))
        .run();
    } else {
      const message = withContainerInstallHint(rawMessage);
      const payload = executionOutputFailure(message, {
        message,
        stack: err instanceof Error ? err.stack : undefined,
      });
      await db
        .update(executions)
        .set({
          status: "failed",
          finishedAt: Date.now(),
          output: JSON.stringify(payload),
        })
        .where(eq(executions.id, runId))
        .run();
      try {
        await ensureRunFailureSideEffects(runId, {
          targetType: "workflow",
          targetId: workflowId,
        });
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Run a workflow and update the execution row (used by execute route and by queue worker).
 * Caller must have already created the execution row with status "running".
 */
export async function runWorkflowAndUpdateExecution(params: {
  runId: string;
  workflowId: string;
  branchId?: string;
  vaultKey?: Buffer | null;
  maxSelfFixRetries?: number;
}): Promise<void> {
  const { runId, workflowId, branchId, vaultKey, maxSelfFixRetries } = params;
  const onStepComplete = async (
    trail: Array<{
      order: number;
      round?: number;
      nodeId: string;
      agentName: string;
      input?: unknown;
      output?: unknown;
      error?: string;
    }>,
    lastOutput: unknown
  ) => {
    const payload = executionOutputSuccess(lastOutput ?? undefined, trail);
    await db
      .update(executions)
      .set({ output: JSON.stringify(payload) })
      .where(eq(executions.id, runId))
      .run();
  };
  const onProgress = async (
    state: { message: string; toolId?: string },
    currentTrail: Array<{
      order: number;
      round?: number;
      nodeId: string;
      agentName: string;
      input?: unknown;
      output?: unknown;
      error?: string;
    }>
  ) => {
    const payload = executionOutputSuccess(
      undefined,
      currentTrail.length > 0 ? currentTrail : undefined,
      state.message
    );
    await db
      .update(executions)
      .set({ output: JSON.stringify(payload) })
      .where(eq(executions.id, runId))
      .run();
  };
  const isCancelled = async () => {
    const rows = await db
      .select({ status: executions.status })
      .from(executions)
      .where(eq(executions.id, runId));
    return rows[0]?.status === "cancelled";
  };
  const onContainerStream = (
    executionId: string,
    chunk: { stdout?: string; stderr?: string; meta?: string }
  ) => {
    if (chunk.stdout) {
      void db
        .insert(runLogs)
        .values({
          id: crypto.randomUUID(),
          executionId,
          level: "stdout",
          message: chunk.stdout,
          payload: null,
          createdAt: Date.now(),
        })
        .run();
    }
    if (chunk.stderr) {
      void db
        .insert(runLogs)
        .values({
          id: crypto.randomUUID(),
          executionId,
          level: "stderr",
          message: chunk.stderr,
          payload: null,
          createdAt: Date.now(),
        })
        .run();
    }
    if (chunk.meta) {
      void db
        .insert(runLogs)
        .values({
          id: crypto.randomUUID(),
          executionId,
          level: "meta",
          message: chunk.meta,
          payload: null,
          createdAt: Date.now(),
        })
        .run();
    }
  };
  try {
    const { output, context, trail } = await runWorkflow({
      workflowId,
      runId,
      branchId,
      vaultKey: vaultKey ?? undefined,
      onStepComplete,
      onProgress,
      isCancelled,
      onContainerStream,
      maxSelfFixRetries: maxSelfFixRetries ?? getWorkflowMaxSelfFixRetries(),
    });
    const payload = executionOutputSuccess(output ?? context, trail);
    await db
      .update(executions)
      .set({ status: "completed", finishedAt: Date.now(), output: JSON.stringify(payload) })
      .where(eq(executions.id, runId))
      .run();
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    if (rawMessage === WAITING_FOR_USER_MESSAGE) {
      if (err instanceof WaitingForUserError && err.trail.length > 0) {
        try {
          const runRows = await db
            .select({ output: executions.output })
            .from(executions)
            .where(eq(executions.id, runId));
          const raw = runRows[0]?.output;
          const parsed =
            raw == null
              ? {}
              : typeof raw === "string"
                ? (JSON.parse(raw) as Record<string, unknown>)
                : (raw as Record<string, unknown>);
          await db
            .update(executions)
            .set({ output: JSON.stringify({ ...parsed, trail: err.trail }) })
            .where(eq(executions.id, runId))
            .run();
        } catch {
          // ignore
        }
      }
      return;
    }
    await destroyContainerSession(runId);
    if (rawMessage === RUN_CANCELLED_MESSAGE) {
      await db
        .update(executions)
        .set({ status: "cancelled", finishedAt: Date.now() })
        .where(eq(executions.id, runId))
        .run();
    } else {
      const message = withContainerInstallHint(rawMessage);
      const payload = executionOutputFailure(message, {
        message,
        stack: err instanceof Error ? err.stack : undefined,
      });
      await db
        .update(executions)
        .set({ status: "failed", finishedAt: Date.now(), output: JSON.stringify(payload) })
        .where(eq(executions.id, runId))
        .run();
    }
    throw err;
  }
}
