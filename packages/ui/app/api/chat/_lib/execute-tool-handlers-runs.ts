/**
 * Tool handlers for runs and execute_workflow: list_runs, cancel_run, respond_to_run, get_run, get_run_messages, get_run_for_improvement, get_feedback_for_scope, execute_workflow.
 */
import type { ExecuteToolContext } from "./execute-tool-shared";
import {
  resolveWorkflowIdFromArgs,
  logToolPhase,
  logToolSuccessAndReturn,
} from "./execute-tool-shared";
import {
  db,
  executions,
  workflows,
  fromExecutionRow,
  toExecutionRow,
  executionOutputSuccess,
  executionOutputFailure,
  getWorkflowMessages,
} from "../../_lib/db";
import {
  runWorkflow,
  RUN_CANCELLED_MESSAGE,
  WAITING_FOR_USER_MESSAGE,
  WaitingForUserError,
} from "../../_lib/run-workflow";
import { enqueueWorkflowResume } from "../../_lib/workflow-queue";
import { getFeedbackForScope } from "../../_lib/feedback-for-scope";
import { getRunForImprovement } from "../../_lib/run-for-improvement";
import { appendLogLine } from "../../_lib/api-logger";
import { createRunNotification } from "../../_lib/notifications-store";
import { ensureRunFailureSideEffects } from "../../_lib/run-failure-side-effects";
import { withContainerInstallHint } from "../../_lib/container-manager";
import { and, desc, eq } from "drizzle-orm";

export const RUNS_TOOL_NAMES = [
  "list_runs",
  "cancel_run",
  "respond_to_run",
  "get_run",
  "get_run_messages",
  "get_run_for_improvement",
  "get_feedback_for_scope",
  "execute_workflow",
] as const;

/** When conversationId is set, restrict run access to that conversation to prevent cross-conversation access. */
function runWhereRunId(runId: string, conversationId: string | undefined) {
  if (conversationId != null && conversationId !== "") {
    return and(eq(executions.id, runId), eq(executions.conversationId, conversationId));
  }
  return eq(executions.id, runId);
}

async function handleListRuns(conversationId: string | undefined): Promise<unknown> {
  const rows =
    conversationId != null && conversationId !== ""
      ? await db
          .select()
          .from(executions)
          .where(eq(executions.conversationId, conversationId))
          .orderBy(desc(executions.startedAt))
          .limit(20)
      : await db.select().from(executions).orderBy(desc(executions.startedAt)).limit(20);
  return rows.map((r) => ({
    id: r.id,
    targetType: r.targetType,
    targetId: r.targetId,
    status: r.status,
  }));
}

async function handleCancelRun(
  a: Record<string, unknown>,
  conversationId: string | undefined
): Promise<unknown> {
  const runId = typeof a.runId === "string" ? (a.runId as string).trim() : "";
  if (!runId) return { error: "runId is required" };
  const runRows = await db.select().from(executions).where(runWhereRunId(runId, conversationId));
  if (runRows.length === 0) return { error: "Run not found" };
  const run = runRows[0];
  if (run.status !== "waiting_for_user" && run.status !== "running") {
    return { error: `Run cannot be cancelled (status: ${run.status})`, runId };
  }
  await db
    .update(executions)
    .set({ status: "cancelled", finishedAt: Date.now() })
    .where(eq(executions.id, runId))
    .run();
  return { id: runId, status: "cancelled", message: "Run cancelled." };
}

async function handleRespondToRun(
  a: Record<string, unknown>,
  conversationId: string | undefined
): Promise<unknown> {
  const runId = typeof a.runId === "string" ? (a.runId as string).trim() : "";
  const responseRaw = typeof a.response === "string" ? (a.response as string).trim() : "";
  if (!runId) return { error: "runId is required" };
  if (!responseRaw) return { error: "response is required" };
  const response = responseRaw;
  const runRows = await db.select().from(executions).where(runWhereRunId(runId, conversationId));
  if (runRows.length === 0) return { error: "Run not found" };
  const run = runRows[0];
  if (run.status !== "waiting_for_user") {
    return { error: `Run is not waiting for user input (status: ${run.status})`, runId };
  }
  const current = (() => {
    try {
      const raw = run.output;
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      return undefined;
    }
  })();
  const existingOutput =
    current &&
    typeof current === "object" &&
    !Array.isArray(current) &&
    current.output !== undefined
      ? current.output
      : undefined;
  const existingTrail = Array.isArray(current?.trail) ? current.trail : [];
  const mergedOutput = {
    ...(existingOutput && typeof existingOutput === "object" && !Array.isArray(existingOutput)
      ? existingOutput
      : {}),
    userResponded: true,
    response,
  };
  const outPayload = executionOutputSuccess(
    mergedOutput,
    existingTrail.length > 0 ? existingTrail : undefined
  );
  await enqueueWorkflowResume({ runId, resumeUserResponse: response });
  await db
    .update(executions)
    .set({ status: "running", finishedAt: null, output: JSON.stringify(outPayload) })
    .where(runWhereRunId(runId, conversationId))
    .run();
  return {
    id: runId,
    status: "running",
    message:
      "Response sent to run. The workflow continues. [View run](/runs/" +
      runId +
      ") to see progress.",
  };
}

async function handleGetRun(
  a: Record<string, unknown>,
  conversationId: string | undefined
): Promise<unknown> {
  const runId = typeof a.id === "string" ? (a.id as string).trim() : "";
  if (!runId) return { error: "id is required" };
  const runRows = await db.select().from(executions).where(runWhereRunId(runId, conversationId));
  if (runRows.length === 0) return { error: "Run not found" };
  const run = runRows[0] as {
    id: string;
    targetType: string;
    targetId: string;
    status: string;
    startedAt: number;
    finishedAt: number | null;
    output: string | null;
  };
  const output = run.output
    ? (() => {
        try {
          return JSON.parse(run.output) as unknown;
        } catch {
          return run.output;
        }
      })()
    : undefined;
  return {
    id: run.id,
    targetType: run.targetType,
    targetId: run.targetId,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    output,
  };
}

async function handleGetRunMessages(
  a: Record<string, unknown>,
  conversationId: string | undefined
): Promise<unknown> {
  const runIdArg =
    typeof (a as { runId?: string }).runId === "string"
      ? (a as { runId: string }).runId.trim()
      : "";
  if (!runIdArg) return { error: "runId is required" };
  const limit =
    typeof (a as { limit?: number }).limit === "number" && (a as { limit: number }).limit > 0
      ? Math.min(100, (a as { limit: number }).limit)
      : 50;
  const runRows = await db
    .select({ id: executions.id })
    .from(executions)
    .where(runWhereRunId(runIdArg, conversationId));
  if (runRows.length === 0) return { error: "Run not found" };
  const messages = await getWorkflowMessages(runIdArg, limit);
  return { runId: runIdArg, messages };
}

async function handleGetRunForImprovement(a: Record<string, unknown>): Promise<unknown> {
  const runIdArg =
    typeof (a as { runId?: string }).runId === "string"
      ? (a as { runId: string }).runId.trim()
      : "";
  if (!runIdArg)
    return {
      error:
        "runId is required. Get a run ID from Runs in the sidebar or from a previous execute_workflow result (use execute_workflow.id).",
    };
  const includeFullLogs = (a as { includeFullLogs?: boolean }).includeFullLogs === true;
  return getRunForImprovement(runIdArg, { includeFullLogs });
}

async function handleGetFeedbackForScope(a: Record<string, unknown>): Promise<unknown> {
  const targetIdRaw =
    typeof (a as { targetId?: string }).targetId === "string"
      ? (a as { targetId: string }).targetId.trim()
      : "";
  const agentIdFallback =
    typeof (a as { agentId?: string }).agentId === "string"
      ? (a as { agentId: string }).agentId.trim()
      : "";
  const targetId = targetIdRaw || agentIdFallback;
  if (!targetId) return { error: "targetId or agentId is required" };
  const rawLabel =
    typeof (a as { label?: string }).label === "string"
      ? (a as { label: string }).label.trim()
      : "";
  const label = rawLabel === "good" || rawLabel === "bad" ? rawLabel : undefined;
  const limit =
    typeof (a as { limit?: number }).limit === "number" && (a as { limit: number }).limit > 0
      ? (a as { limit: number }).limit
      : undefined;
  return getFeedbackForScope(targetId, { label, limit });
}

async function handleExecuteWorkflow(
  a: Record<string, unknown>,
  conversationId: string | undefined,
  vaultKey: Buffer | null
): Promise<unknown> {
  const wfResolved = resolveWorkflowIdFromArgs(a);
  if ("error" in wfResolved) return { error: wfResolved.error };
  const workflowId = wfResolved.workflowId;
  const branchId =
    typeof a.branchId === "string" && a.branchId.trim() ? (a.branchId as string) : undefined;
  const rawInputs =
    a.inputs != null && typeof a.inputs === "object" && !Array.isArray(a.inputs)
      ? (a.inputs as Record<string, unknown>)
      : undefined;
  const noSharedOutput = rawInputs?.noSharedOutput === true;
  const runInputs =
    rawInputs != null && noSharedOutput
      ? (() => {
          const { noSharedOutput: _drop, ...rest } = rawInputs;
          return Object.keys(rest).length > 0 ? rest : undefined;
        })()
      : rawInputs;
  const wfRows = await db.select().from(workflows).where(eq(workflows.id, workflowId));
  if (wfRows.length === 0) return { error: "Workflow not found" };
  const runId = crypto.randomUUID();
  const run = {
    id: runId,
    targetType: "workflow",
    targetId: workflowId,
    targetBranchId: branchId ?? null,
    conversationId: conversationId ?? null,
    status: "running",
  };
  await db.insert(executions).values(toExecutionRow(run)).run();
  try {
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
    const { output, context, trail } = await runWorkflow({
      workflowId,
      runId,
      branchId,
      runInputs,
      noSharedOutput,
      vaultKey: vaultKey ?? undefined,
      onStepComplete,
      onProgress,
      isCancelled,
    });
    const payload = executionOutputSuccess(output ?? context, trail);
    await db
      .update(executions)
      .set({ status: "completed", finishedAt: Date.now(), output: JSON.stringify(payload) })
      .where(eq(executions.id, runId))
      .run();
    try {
      await createRunNotification(runId, "completed", {
        targetType: "workflow",
        targetId: workflowId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendLogLine(
        "chat/execute-tool",
        "notification",
        `createRunNotification failed runId=${runId} workflowId=${workflowId} error=${msg}`
      );
    }
    const updated = await db.select().from(executions).where(eq(executions.id, runId));
    const runResult = fromExecutionRow(updated[0]);
    return {
      id: runId,
      workflowId,
      status: "completed",
      message:
        "Workflow run completed. Check Runs in the sidebar for full output and execution trail.",
      output: runResult.output,
    };
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    const cancelled = rawMessage === RUN_CANCELLED_MESSAGE;
    if (cancelled) {
      await db
        .update(executions)
        .set({ status: "cancelled", finishedAt: Date.now() })
        .where(eq(executions.id, runId))
        .run();
      return {
        id: runId,
        workflowId,
        status: "cancelled",
        message: "Run was stopped by the user.",
      };
    }
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
          const merged = { ...parsed, trail: err.trail };
          await db
            .update(executions)
            .set({ output: JSON.stringify(merged) })
            .where(eq(executions.id, runId))
            .run();
        } catch {
          // ignore
        }
      }
      let question: string | undefined;
      let options: string[] = [];
      try {
        const runRows = await db
          .select({ output: executions.output })
          .from(executions)
          .where(eq(executions.id, runId));
        const raw = runRows[0]?.output;
        const out =
          raw == null
            ? undefined
            : typeof raw === "string"
              ? (JSON.parse(raw) as Record<string, unknown>)
              : (raw as Record<string, unknown>);
        if (out && typeof out === "object") {
          const inner =
            out.output && typeof out.output === "object" && out.output !== null
              ? (out.output as Record<string, unknown>)
              : out;
          const q = (typeof inner?.question === "string" ? inner.question : undefined)?.trim();
          const msg = (typeof inner?.message === "string" ? inner.message : undefined)?.trim();
          question =
            q || msg || (typeof out.question === "string" ? out.question.trim() : undefined);
          const opts = Array.isArray(inner?.suggestions)
            ? inner.suggestions
            : Array.isArray(inner?.options)
              ? inner.options
              : Array.isArray(out.suggestions)
                ? out.suggestions
                : undefined;
          options = opts?.map((o) => String(o)).filter(Boolean) ?? [];
        }
      } catch {
        // ignore
      }
      await db
        .update(executions)
        .set({ status: "waiting_for_user" })
        .where(eq(executions.id, runId))
        .run();
      return {
        id: runId,
        workflowId,
        status: "waiting_for_user",
        message: "Run is waiting for user input. Respond from Chat or the run detail page.",
        ...(question && { question }),
        ...(options.length > 0 && { options }),
      };
    }
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
    try {
      await ensureRunFailureSideEffects(runId, {
        targetType: "workflow",
        targetId: workflowId,
      });
    } catch {
      // ignore
    }
    return {
      id: runId,
      workflowId,
      status: "failed",
      error: message,
      message: `Workflow run failed: ${message}`,
    };
  }
}

export async function handleRunTools(
  name: string,
  a: Record<string, unknown>,
  ctx: ExecuteToolContext | undefined
): Promise<unknown> {
  logToolPhase(ctx, "start", name);
  try {
    const conversationId = ctx?.conversationId;
    const vaultKey = ctx?.vaultKey ?? null;

    switch (name) {
      case "list_runs":
        return logToolSuccessAndReturn(ctx, name, await handleListRuns(conversationId));
      case "cancel_run":
        return await handleCancelRun(a, conversationId);
      case "respond_to_run":
        return await handleRespondToRun(a, conversationId);
      case "get_run":
        return await handleGetRun(a, conversationId);
      case "get_run_messages":
        return await handleGetRunMessages(a, conversationId);
      case "get_run_for_improvement":
        return await handleGetRunForImprovement(a);
      case "get_feedback_for_scope":
        return await handleGetFeedbackForScope(a);
      case "execute_workflow":
        return await handleExecuteWorkflow(a, conversationId, vaultKey);
      default:
        return undefined;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logToolPhase(ctx, "error", name, `error=${msg}`);
    throw err;
  }
}
