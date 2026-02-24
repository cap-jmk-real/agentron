/**
 * Shared constants and error class for workflow run. Split out to avoid circular imports
 * between run-workflow.ts and run-workflow-engine.ts.
 */

export const WAITING_FOR_USER_MESSAGE = "WAITING_FOR_USER";
export const RUN_CANCELLED_MESSAGE = "Run cancelled by user";

export type ExecutionTraceStep = {
  nodeId: string;
  agentId: string;
  agentName: string;
  order: number;
  round?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
  toolCalls?: Array<{ name: string; argsSummary?: string; resultSummary?: string }>;
  inputIsUserReply?: boolean;
  sentToNodeId?: string;
  sentToAgentName?: string;
  llmSummary?: string;
};

/** Thrown when request_user_help runs; carries the execution trail so the run output can preserve it. */
export class WaitingForUserError extends Error {
  constructor(
    message: string,
    public readonly trail: ExecutionTraceStep[]
  ) {
    super(message);
    this.name = "WaitingForUserError";
  }
}

/** True if a tool result indicates failure (error, non-zero exitCode, or HTTP 4xx/5xx). Used for self-fix loop. */
export function isToolResultFailure(result: unknown): boolean {
  if (result == null || typeof result !== "object") return false;
  const r = result as Record<string, unknown>;
  if (typeof r.error === "string" && r.error.trim().length > 0) return true;
  const exitCode = r.exitCode;
  if (typeof exitCode === "number" && exitCode !== 0) return true;
  const statusCode = r.statusCode ?? r.status;
  const code = typeof statusCode === "number" ? statusCode : undefined;
  if (code != null && code >= 400 && code <= 599) return true;
  return false;
}
