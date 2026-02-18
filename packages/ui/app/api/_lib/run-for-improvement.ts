/**
 * Build run context for the improvement agent (bounded by default for token minimal usage).
 * Used by GET /api/runs/[id]/for-improvement and by the get_run_for_improvement tool in workflow/chat.
 */
import { eq, asc } from "drizzle-orm";
import { db, executions, runLogs, fromExecutionRow } from "./db";

const RECENT_ERRORS_N = 25;
const PAYLOAD_MAX_CHARS = 300;
const RUN_LOG_LINES_CAP_BOUNDED = 50;
const RUN_LOG_LINES_CAP_FULL = 200;

type RunLogRow = { level: string; message: string; payload: string | null; createdAt: number };

function trailSummary(trail: Array<{ order: number; nodeId?: string; agentName?: string; error?: string; toolCalls?: unknown[] }>): string[] {
  if (!Array.isArray(trail) || trail.length === 0) return [];
  const sorted = trail.slice().sort((a, b) => a.order - b.order);
  return sorted.map((s) => {
    const name = s.agentName ?? s.nodeId ?? "?";
    const status = s.error && s.error !== "WAITING_FOR_USER" ? "error" : "ok";
    const lastTool = Array.isArray(s.toolCalls) && s.toolCalls.length > 0
      ? (s.toolCalls[s.toolCalls.length - 1] as { name?: string })?.name ?? ""
      : "";
    return `${name}: ${status}${lastTool ? ` (last: ${lastTool})` : ""}`;
  });
}

function recentErrorsFromLogs(logRows: RunLogRow[], bounded: boolean): Array<{ source: string; message: string; payload?: string }> {
  const cap = bounded ? RUN_LOG_LINES_CAP_BOUNDED : RUN_LOG_LINES_CAP_FULL;
  const take = bounded ? Math.min(RECENT_ERRORS_N, logRows.length) : logRows.length;
  const slice = logRows.slice(-take).slice(-cap);
  return slice.map((r) => {
    const payloadStr = r.payload != null && r.payload !== "" ? r.payload : undefined;
    let payloadTrimmed: string | undefined;
    if (payloadStr && bounded) {
      try {
        const p = JSON.parse(payloadStr) as Record<string, unknown>;
        const s = JSON.stringify(p);
        payloadTrimmed = s.length > PAYLOAD_MAX_CHARS ? s.slice(0, PAYLOAD_MAX_CHARS) + "…" : s;
      } catch {
        payloadTrimmed = payloadStr.length > PAYLOAD_MAX_CHARS ? payloadStr.slice(0, PAYLOAD_MAX_CHARS) + "…" : payloadStr;
      }
    } else if (payloadStr) {
      payloadTrimmed = payloadStr;
    }
    const sourceMatch = r.message.match(/^\[([^\]]+)\]/);
    const source = sourceMatch ? sourceMatch[1] : r.level;
    return { source, message: r.message, ...(payloadTrimmed ? { payload: payloadTrimmed } : {}) };
  });
}

export type GetRunForImprovementOptions = { includeFullLogs?: boolean };

export type RunForImprovementResult = {
  id: string;
  targetType: string;
  targetId: string;
  status: string;
  startedAt: number;
  finishedAt: number | null;
  trailSummary?: string[];
  recentErrors?: Array<{ source: string; message: string; payload?: string }>;
  output?: unknown;
  trail?: unknown[];
  logs?: Array<{ level: string; message: string; payload: string | null; createdAt: number }>;
};

export async function getRunForImprovement(
  runId: string,
  options: GetRunForImprovementOptions = {}
): Promise<RunForImprovementResult | { error: string }> {
  const includeFullLogs = options.includeFullLogs === true;
  const rows = await db.select().from(executions).where(eq(executions.id, runId));
  if (rows.length === 0) return { error: "Run not found" };
  const run = fromExecutionRow(rows[0]);
  const output = run.output as Record<string, unknown> | undefined;
  const trail = Array.isArray(output?.trail) ? (output.trail as Array<{ order: number; nodeId?: string; agentName?: string; error?: string; toolCalls?: unknown[] }>) : [];

  const logRows = await db
    .select({ level: runLogs.level, message: runLogs.message, payload: runLogs.payload, createdAt: runLogs.createdAt })
    .from(runLogs)
    .where(eq(runLogs.executionId, runId))
    .orderBy(asc(runLogs.createdAt));

  const logRowsOrdered = logRows as RunLogRow[];

  if (includeFullLogs) {
    const logsCap = logRowsOrdered.slice(-RUN_LOG_LINES_CAP_FULL);
    return {
      id: run.id,
      targetType: run.targetType,
      targetId: run.targetId,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      output: run.output,
      trail,
      recentErrors: recentErrorsFromLogs(logRowsOrdered, false),
      logs: logsCap,
    };
  }

  return {
    id: run.id,
    targetType: run.targetType,
    targetId: run.targetId,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    trailSummary: trailSummary(trail),
    recentErrors: recentErrorsFromLogs(logRowsOrdered, true),
  };
}

/**
 * Build a one-line "what went wrong" summary from run logs (for UI).
 */
export function buildWhatWentWrongOneLiner(logs: Array<{ level: string; message: string; payload?: string | null }>): string {
  const errOrStderr = logs.filter((e) => e.level === "stderr" || (e.message && /\[.*\]/.test(e.message)));
  if (errOrStderr.length === 0) return "";
  const parts = errOrStderr.slice(-10).map((e) => {
    const m = e.message.replace(/\n/g, " ").trim();
    const sourceMatch = m.match(/^\[([^\]]+)\]/);
    const source = sourceMatch ? sourceMatch[1] : e.level;
    const rest = sourceMatch ? m.slice(sourceMatch[0].length).trim() : m;
    const short = rest.length > 60 ? rest.slice(0, 57) + "…" : rest;
    return `[${source}] ${short}`;
  });
  const n = errOrStderr.length;
  if (n <= 3) return parts.join("; ");
  return `${n} errors: ${parts.slice(-2).join("; ")}`;
}
