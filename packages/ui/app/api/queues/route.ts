import { and, asc, desc, eq, inArray, or, isNotNull } from "drizzle-orm";
import { json } from "../_lib/response";
import { db, conversationLocks, chatMessages, messageQueueLog } from "../_lib/db";
import {
  getWorkflowQueueStatus,
  listWorkflowQueueJobs,
  type WorkflowQueueJobRow,
} from "../_lib/workflow-queue";

export const runtime = "nodejs";

export type ChatTraceEntry = {
  conversationId: string;
  messageId: string;
  createdAt: number;
  toolCalls: Array<{ name: string; args?: Record<string, unknown>; result?: unknown }>;
  llmTrace: Array<{
    phase?: string;
    messageCount?: number;
    responsePreview?: string;
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  }>;
};

export type MessageQueueLogEntry = {
  id: string;
  type: string;
  phase: string | null;
  label: string | null;
  payload: string | null;
  createdAt: number;
};

export type QueuesResponse = {
  workflowQueue: {
    status: { queued: number; running: number; concurrency: number };
    jobs: WorkflowQueueJobRow[];
  };
  conversationLocks: Array<{ conversationId: string; startedAt: number; createdAt: number }>;
  /** For each locked conversation, the latest assistant message trace (tool calls + LLM) so the queue UI can show what the assistant did. */
  activeChatTraces: ChatTraceEntry[];
  /** Atomistic steps for each locked conversation (trace_step, step_start, todo_done, plan, done) so the queue UI can show what is happening in real time. */
  messageQueueLog: Array<{ conversationId: string; steps: MessageQueueLogEntry[] }>;
};

function parseJson<T>(raw: string | null | undefined): T | undefined {
  if (raw == null || raw === "") return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/**
 * GET /api/queues
 * Returns all queue-related state: workflow queue (status + jobs), active conversation locks, and chat trace data for locked conversations.
 */
export async function GET() {
  const [status, jobs, lockRows] = await Promise.all([
    getWorkflowQueueStatus(),
    listWorkflowQueueJobs({ limit: 100 }),
    db.select().from(conversationLocks),
  ]);

  const lockIds = lockRows.map((r) => r.conversationId);
  let activeChatTraces: ChatTraceEntry[] = [];
  let messageQueueLogResult: Array<{ conversationId: string; steps: MessageQueueLogEntry[] }> = [];

  if (lockIds.length > 0) {
    const rows = await db
      .select({
        id: chatMessages.id,
        conversationId: chatMessages.conversationId,
        createdAt: chatMessages.createdAt,
        toolCalls: chatMessages.toolCalls,
        llmTrace: chatMessages.llmTrace,
      })
      .from(chatMessages)
      .where(
        and(
          inArray(chatMessages.conversationId, lockIds),
          eq(chatMessages.role, "assistant"),
          or(isNotNull(chatMessages.toolCalls), isNotNull(chatMessages.llmTrace))
        )
      )
      .orderBy(desc(chatMessages.createdAt));

    const byConversation = new Map<string, (typeof rows)[0]>();
    for (const row of rows) {
      const cid = row.conversationId;
      if (cid && lockIds.includes(cid) && !byConversation.has(cid)) {
        byConversation.set(cid, row);
      }
    }

    activeChatTraces = lockIds
      .filter((cid) => byConversation.has(cid))
      .map((conversationId) => {
        const row = byConversation.get(conversationId)!;
        const toolCallsRaw = parseJson<
          Array<{
            name?: string;
            args?: Record<string, unknown>;
            arguments?: Record<string, unknown>;
            result?: unknown;
          }>
        >(row.toolCalls);
        const llmTraceRaw = parseJson<
          Array<{
            phase?: string;
            messageCount?: number;
            responsePreview?: string;
            usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
          }>
        >(row.llmTrace);
        const toolCalls = Array.isArray(toolCallsRaw)
          ? toolCallsRaw.map((t) => ({
              name: typeof t.name === "string" ? t.name : "",
              args: t.args ?? t.arguments,
              result: t.result,
            }))
          : [];
        const llmTrace = Array.isArray(llmTraceRaw) ? llmTraceRaw : [];
        return {
          conversationId,
          messageId: row.id,
          createdAt: row.createdAt,
          toolCalls,
          llmTrace,
        };
      });

    const logRows = await db
      .select({
        id: messageQueueLog.id,
        conversationId: messageQueueLog.conversationId,
        type: messageQueueLog.type,
        phase: messageQueueLog.phase,
        label: messageQueueLog.label,
        payload: messageQueueLog.payload,
        createdAt: messageQueueLog.createdAt,
      })
      .from(messageQueueLog)
      .where(inArray(messageQueueLog.conversationId, lockIds))
      .orderBy(asc(messageQueueLog.createdAt));

    const stepsByConv = new Map<string, MessageQueueLogEntry[]>();
    for (const r of logRows) {
      const cid = r.conversationId;
      if (!cid || !lockIds.includes(cid)) continue;
      const list = stepsByConv.get(cid) ?? [];
      list.push({
        id: r.id,
        type: r.type,
        phase: r.phase ?? null,
        label: r.label ?? null,
        payload: r.payload ?? null,
        createdAt: r.createdAt,
      });
      stepsByConv.set(cid, list);
    }
    messageQueueLogResult = lockIds.map((conversationId) => ({
      conversationId,
      steps: stepsByConv.get(conversationId) ?? [],
    }));
  }

  const response: QueuesResponse = {
    workflowQueue: { status, jobs },
    conversationLocks: lockRows.map((r) => ({
      conversationId: r.conversationId,
      startedAt: r.startedAt,
      createdAt: r.createdAt,
    })),
    activeChatTraces,
    messageQueueLog: messageQueueLogResult,
  };
  return json(response);
}
