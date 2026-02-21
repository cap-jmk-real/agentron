/**
 * Execution log: per-run step history for workflow debugging (same detail level as message queue log for chat).
 * Phases: llm_request, llm_response, tool_call, tool_result, node_start, node_done.
 */
import { eq, desc, asc } from "drizzle-orm";
import { db, executionLog } from "./db";

const EXECUTION_LOG_PAYLOAD_MAX = 8000;

function capPayload(v: unknown): unknown {
  if (v == null) return v;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length <= EXECUTION_LOG_PAYLOAD_MAX ? v : s.slice(0, EXECUTION_LOG_PAYLOAD_MAX) + "…";
}

async function getNextSequence(executionId: string): Promise<number> {
  const rows = await db
    .select({ sequence: executionLog.sequence })
    .from(executionLog)
    .where(eq(executionLog.executionId, executionId))
    .orderBy(desc(executionLog.sequence))
    .limit(1);
  return rows.length > 0 && typeof rows[0].sequence === "number" ? rows[0].sequence + 1 : 1;
}

/** Append one step to the execution log (for workflow run debugging). */
export async function appendExecutionLogStep(
  executionId: string,
  phase: string,
  label: string | null,
  payload?: Record<string, unknown> | null
): Promise<void> {
  const sequence = await getNextSequence(executionId);
  const safePayload = payload != null ? capPayload(payload) : null;
  const payloadStr = safePayload != null ? JSON.stringify(safePayload) : null;
  await db
    .insert(executionLog)
    .values({
      id: crypto.randomUUID(),
      executionId,
      sequence,
      phase,
      label,
      payload: payloadStr,
      createdAt: Date.now(),
    })
    .run();
}

export type ExecutionLogEntry = {
  id: string;
  executionId: string;
  sequence: number;
  phase: string;
  label: string | null;
  payload: string | null;
  createdAt: number;
};

/** Get full execution log for a run (ordered by sequence). */
export async function getExecutionLogForRun(executionId: string): Promise<ExecutionLogEntry[]> {
  const rows = await db
    .select()
    .from(executionLog)
    .where(eq(executionLog.executionId, executionId))
    .orderBy(asc(executionLog.sequence));
  return rows.map((r) => ({
    id: r.id,
    executionId: r.executionId,
    sequence: r.sequence,
    phase: r.phase,
    label: r.label ?? null,
    payload: r.payload ?? null,
    createdAt: r.createdAt,
  }));
}
