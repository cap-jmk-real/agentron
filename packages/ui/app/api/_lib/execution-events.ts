/**
 * Event-driven workflow execution: DB-backed event queue and run state.
 * Events: RunStarted, NodeRequested(nodeId), NodeCompleted(nodeId, output), UserResponded(content).
 */
import { eq, asc } from "drizzle-orm";
import { db, executionEvents, executionRunState } from "./db";

export type ExecutionEventType = "RunStarted" | "NodeRequested" | "NodeCompleted" | "UserResponded";

export type ExecutionRunStateRow = {
  executionId: string;
  workflowId: string;
  targetBranchId: string | null;
  currentNodeId: string | null;
  round: number;
  sharedContext: string;
  status: "running" | "waiting_for_user" | "completed" | "failed";
  waitingAtNodeId: string | null;
  trailSnapshot: string | null;
  updatedAt: number;
};

function parseJson<T>(raw: string | null, fallback: T): T {
  if (raw == null || raw === "") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Get next sequence number for an execution. */
async function getNextSequence(executionId: string): Promise<number> {
  const rows = await db
    .select({ sequence: executionEvents.sequence })
    .from(executionEvents)
    .where(eq(executionEvents.executionId, executionId))
    .orderBy(asc(executionEvents.sequence));
  if (rows.length === 0) return 1;
  const max = Math.max(...rows.map((r) => r.sequence ?? 0));
  return max + 1;
}

/** Enqueue an event for an execution. */
export async function enqueueExecutionEvent(
  executionId: string,
  type: ExecutionEventType,
  payload?: Record<string, unknown>
): Promise<string> {
  const id = crypto.randomUUID();
  const sequence = await getNextSequence(executionId);
  await db.insert(executionEvents).values({
    id,
    executionId,
    sequence,
    type,
    payload: payload != null ? JSON.stringify(payload) : null,
    processedAt: null,
    createdAt: Date.now(),
  });
  return id;
}

/** Get the next unprocessed event for an execution (lowest sequence). */
export async function getNextPendingEvent(
  executionId: string
): Promise<{ id: string; type: string; payload: Record<string, unknown> | null; sequence: number } | null> {
  const rows = await db
    .select()
    .from(executionEvents)
    .where(eq(executionEvents.executionId, executionId))
    .orderBy(asc(executionEvents.sequence));
  const pending = rows.find((r) => r.processedAt == null);
  if (!pending) return null;
  return {
    id: pending.id,
    type: pending.type,
    payload: parseJson(pending.payload, null),
    sequence: pending.sequence,
  };
}

/** Mark an event as processed. */
export async function markEventProcessed(eventId: string): Promise<void> {
  await db
    .update(executionEvents)
    .set({ processedAt: Date.now() })
    .where(eq(executionEvents.id, eventId));
}

/** Event row as returned for listing/copy (full queue for a run). */
export type ExecutionEventRow = {
  id: string;
  executionId: string;
  sequence: number;
  type: string;
  payload: Record<string, unknown> | null;
  processedAt: number | null;
  createdAt: number;
};

/** Get the full event queue for one run (ordered by sequence). Use for diagnosis and "Copy for support". */
export async function getExecutionEventsForRun(executionId: string): Promise<ExecutionEventRow[]> {
  const rows = await db
    .select()
    .from(executionEvents)
    .where(eq(executionEvents.executionId, executionId))
    .orderBy(asc(executionEvents.sequence));
  return rows.map((r) => ({
    id: r.id,
    executionId: r.executionId,
    sequence: r.sequence,
    type: r.type,
    payload: parseJson(r.payload, null),
    processedAt: r.processedAt ?? null,
    createdAt: r.createdAt,
  }));
}

/** Load run state for an execution. Returns null if none. */
export async function getExecutionRunState(executionId: string): Promise<ExecutionRunStateRow | null> {
  const rows = await db.select().from(executionRunState).where(eq(executionRunState.executionId, executionId));
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    executionId: r.executionId,
    workflowId: r.workflowId,
    targetBranchId: r.targetBranchId ?? null,
    currentNodeId: r.currentNodeId ?? null,
    round: r.round,
    sharedContext: r.sharedContext,
    status: r.status as ExecutionRunStateRow["status"],
    waitingAtNodeId: r.waitingAtNodeId ?? null,
    trailSnapshot: r.trailSnapshot ?? null,
    updatedAt: r.updatedAt,
  };
}

/** Upsert run state. Omitted fields are left unchanged on update. */
export async function setExecutionRunState(
  executionId: string,
  state: {
    workflowId: string;
    targetBranchId?: string | null;
    currentNodeId?: string | null;
    round: number;
    sharedContext: Record<string, unknown> | string;
    status: "running" | "waiting_for_user" | "completed" | "failed";
    waitingAtNodeId?: string | null;
    trailSnapshot?: unknown[] | string | null;
  }
): Promise<void> {
  const sharedContext =
    typeof state.sharedContext === "string" ? state.sharedContext : JSON.stringify(state.sharedContext);
  const trailSnapshot =
    state.trailSnapshot == null
      ? null
      : typeof state.trailSnapshot === "string"
        ? state.trailSnapshot
        : JSON.stringify(state.trailSnapshot);
  const now = Date.now();
  const existing = await db.select().from(executionRunState).where(eq(executionRunState.executionId, executionId));
  if (existing.length === 0) {
    await db.insert(executionRunState).values({
      executionId,
      workflowId: state.workflowId,
      targetBranchId: state.targetBranchId ?? null,
      currentNodeId: state.currentNodeId ?? null,
      round: state.round,
      sharedContext,
      status: state.status,
      waitingAtNodeId: state.waitingAtNodeId ?? null,
      trailSnapshot,
      updatedAt: now,
    });
  } else {
    const prev = existing[0];
    const updates: Record<string, unknown> = {
      updatedAt: now,
      targetBranchId: state.targetBranchId ?? prev.targetBranchId,
      currentNodeId: state.currentNodeId ?? prev.currentNodeId,
      round: state.round,
      sharedContext,
      status: state.status,
      waitingAtNodeId: state.waitingAtNodeId ?? prev.waitingAtNodeId,
      trailSnapshot: trailSnapshot ?? prev.trailSnapshot,
    };
    await db.update(executionRunState).set(updates as Record<string, unknown>).where(eq(executionRunState.executionId, executionId));
  }
}

/** Update only specific run state fields (e.g. status, waitingAtNodeId, trailSnapshot). */
export async function updateExecutionRunState(
  executionId: string,
  patch: Partial<{
    currentNodeId: string | null;
    round: number;
    sharedContext: Record<string, unknown> | string;
    status: "running" | "waiting_for_user" | "completed" | "failed";
    waitingAtNodeId: string | null;
    trailSnapshot: unknown[] | string | null;
  }>
): Promise<void> {
  const existing = await db.select().from(executionRunState).where(eq(executionRunState.executionId, executionId));
  if (existing.length === 0) return;
  const now = Date.now();
  const row = existing[0];
  const updates: Record<string, unknown> = { updatedAt: now };
  if (patch.currentNodeId !== undefined) updates.currentNodeId = patch.currentNodeId;
  if (patch.round !== undefined) updates.round = patch.round;
  if (patch.sharedContext !== undefined) {
    updates.sharedContext = typeof patch.sharedContext === "string" ? patch.sharedContext : JSON.stringify(patch.sharedContext);
  }
  if (patch.status !== undefined) updates.status = patch.status;
  if (patch.waitingAtNodeId !== undefined) updates.waitingAtNodeId = patch.waitingAtNodeId;
  if (patch.trailSnapshot !== undefined) {
    updates.trailSnapshot =
      patch.trailSnapshot == null ? null : typeof patch.trailSnapshot === "string" ? patch.trailSnapshot : JSON.stringify(patch.trailSnapshot);
  }
  await db.update(executionRunState).set(updates as Record<string, unknown>).where(eq(executionRunState.executionId, executionId));
}

/** Parse sharedContext JSON from run state. */
export function parseRunStateSharedContext(state: ExecutionRunStateRow): Record<string, unknown> {
  return parseJson(state.sharedContext, {});
}
