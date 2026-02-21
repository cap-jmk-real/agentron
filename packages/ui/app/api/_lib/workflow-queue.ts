/**
 * DB-backed workflow run queue. No in-memory queue; all jobs are in workflow_queue table.
 * Concurrency limit 2. Worker runs when waitForJob polls or when processOneWorkflowJob is called.
 */
import { eq, asc } from "drizzle-orm";
import { db, workflowQueue } from "./db";
import { runWorkflowAndUpdateExecution } from "./run-workflow";
import { runWorkflowForRun } from "./run-workflow";
import { runOneScheduledWorkflow } from "./run-scheduled-workflow";

const CONCURRENCY = 2;

export type WorkflowQueueJobType = "workflow_start" | "workflow_resume" | "scheduled";

export type WorkflowQueueJobRow = {
  id: string;
  type: string;
  payload: string;
  status: string;
  runId: string | null;
  enqueuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  createdAt: number;
};

function parsePayload(payload: string): Record<string, unknown> {
  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Enqueue a new workflow run (execute route). Returns job id. */
export async function enqueueWorkflowStart(params: {
  runId: string;
  workflowId: string;
  branchId?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await db
    .insert(workflowQueue)
    .values({
      id,
      type: "workflow_start",
      payload: JSON.stringify({
        runId: params.runId,
        workflowId: params.workflowId,
        branchId: params.branchId ?? null,
      }),
      status: "queued",
      runId: params.runId,
      enqueuedAt: now,
      startedAt: null,
      finishedAt: null,
      error: null,
      createdAt: now,
    })
    .run();
  return id;
}

/** Enqueue a workflow resume (respond_to_run). Returns job id. */
export async function enqueueWorkflowResume(params: {
  runId: string;
  resumeUserResponse?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await db
    .insert(workflowQueue)
    .values({
      id,
      type: "workflow_resume",
      payload: JSON.stringify({
        runId: params.runId,
        resumeUserResponse: params.resumeUserResponse ?? null,
      }),
      status: "queued",
      runId: params.runId,
      enqueuedAt: now,
      startedAt: null,
      finishedAt: null,
      error: null,
      createdAt: now,
    })
    .run();
  return id;
}

/** Enqueue a scheduled workflow run. Returns job id. */
export async function enqueueScheduledWorkflow(params: {
  workflowId: string;
  branchId?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await db
    .insert(workflowQueue)
    .values({
      id,
      type: "scheduled",
      payload: JSON.stringify({ workflowId: params.workflowId, branchId: params.branchId ?? null }),
      status: "queued",
      runId: null,
      enqueuedAt: now,
      startedAt: null,
      finishedAt: null,
      error: null,
      createdAt: now,
    })
    .run();
  return id;
}

/** Get one job by id. */
export async function getWorkflowQueueJob(jobId: string): Promise<WorkflowQueueJobRow | null> {
  const rows = await db.select().from(workflowQueue).where(eq(workflowQueue.id, jobId));
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    type: r.type,
    payload: r.payload,
    status: r.status,
    runId: r.runId ?? null,
    enqueuedAt: r.enqueuedAt,
    startedAt: r.startedAt ?? null,
    finishedAt: r.finishedAt ?? null,
    error: r.error ?? null,
    createdAt: r.createdAt,
  };
}

/** List all workflow queue jobs (for Queues UI). */
export async function listWorkflowQueueJobs(opts?: {
  status?: string;
  limit?: number;
}): Promise<WorkflowQueueJobRow[]> {
  const limit = opts?.limit ?? 200;
  const rows = opts?.status
    ? await db
        .select()
        .from(workflowQueue)
        .where(eq(workflowQueue.status, opts.status))
        .orderBy(asc(workflowQueue.createdAt))
        .limit(limit)
    : await db.select().from(workflowQueue).orderBy(asc(workflowQueue.createdAt)).limit(limit);
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    payload: r.payload,
    status: r.status,
    runId: r.runId ?? null,
    enqueuedAt: r.enqueuedAt,
    startedAt: r.startedAt ?? null,
    finishedAt: r.finishedAt ?? null,
    error: r.error ?? null,
    createdAt: r.createdAt,
  }));
}

/** Count by status (for UI summary). */
export async function getWorkflowQueueStatus(): Promise<{
  queued: number;
  running: number;
  concurrency: number;
}> {
  const rows = await db.select({ status: workflowQueue.status }).from(workflowQueue);
  const queued = rows.filter((r) => r.status === "queued").length;
  const running = rows.filter((r) => r.status === "running").length;
  return { queued, running, concurrency: CONCURRENCY };
}

/** Process one queued job if there is capacity. Caller can pass vaultKey when waiting for this job (for workflow_start). */
export async function processOneWorkflowJob(options?: {
  waitingJobId?: string;
  vaultKey?: Buffer | null;
}): Promise<boolean> {
  const runningRows = await db
    .select()
    .from(workflowQueue)
    .where(eq(workflowQueue.status, "running"));
  if (runningRows.length >= CONCURRENCY) return false;

  const queuedRows = await db
    .select()
    .from(workflowQueue)
    .where(eq(workflowQueue.status, "queued"))
    .orderBy(asc(workflowQueue.createdAt))
    .limit(1);
  if (queuedRows.length === 0) return false;

  const row = queuedRows[0];
  const now = Date.now();
  await db
    .update(workflowQueue)
    .set({ status: "running", startedAt: now })
    .where(eq(workflowQueue.id, row.id))
    .run();

  const payload = parsePayload(row.payload);
  const isWaitingJob = options?.waitingJobId === row.id;

  try {
    if (row.type === "workflow_start") {
      const runId = payload.runId as string;
      const workflowId = payload.workflowId as string;
      const branchId = payload.branchId as string | undefined;
      const vaultKey = isWaitingJob ? options?.vaultKey : undefined;
      await runWorkflowAndUpdateExecution({ runId, workflowId, branchId, vaultKey });
    } else if (row.type === "workflow_resume") {
      const runId = payload.runId as string;
      const resumeUserResponse = payload.resumeUserResponse as string | undefined;
      await runWorkflowForRun(runId, { resumeUserResponse });
    } else if (row.type === "scheduled") {
      const workflowId = payload.workflowId as string;
      const branchId = payload.branchId as string | undefined;
      await runOneScheduledWorkflow(workflowId, branchId);
    }
    await db
      .update(workflowQueue)
      .set({ status: "completed", finishedAt: Date.now() })
      .where(eq(workflowQueue.id, row.id))
      .run();
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await db
      .update(workflowQueue)
      .set({ status: "failed", finishedAt: Date.now(), error: errMsg.slice(0, 2000) })
      .where(eq(workflowQueue.id, row.id))
      .run();
    if (isWaitingJob) throw err;
  }
  return true;
}

const POLL_INTERVAL_MS = 300;
const MAX_POLL_MS = 600_000; // 10 min

/** Wait for a job to complete by polling and processing the queue. Pass vaultKey when waiting for a workflow_start job. */
export async function waitForJob(
  jobId: string,
  options?: { vaultKey?: Buffer | null; timeoutMs?: number }
): Promise<WorkflowQueueJobRow> {
  const deadline = Date.now() + (options?.timeoutMs ?? MAX_POLL_MS);
  while (Date.now() < deadline) {
    const job = await getWorkflowQueueJob(jobId);
    if (!job) throw new Error("Job not found");
    if (job.status === "completed" || job.status === "failed") return job;
    await processOneWorkflowJob({ waitingJobId: jobId, vaultKey: options?.vaultKey });
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("Timeout waiting for job");
}
