import { and, asc, desc, eq, or, gt, sql } from "drizzle-orm";
import { json } from "../../_lib/response";
import { db, messageQueueLog } from "../../_lib/db";

export const runtime = "nodejs";

export type MessageQueueLogEntry = {
  id: string;
  type: string;
  phase: string | null;
  label: string | null;
  payload: string | null;
  createdAt: number;
};

const DEFAULT_CONVERSATIONS_LIMIT = 20;
const DEFAULT_STEPS_LIMIT = 50;
const MAX_STEPS_LIMIT = 200;

/**
 * GET /api/queues/message-log
 * Paginated message queue log.
 * - No conversationId: list conversations that have log entries (lastAt, stepCount), paginated by offset.
 * - conversationId set: list steps for that conversation, paginated by cursor (createdAt,id).
 * Query: conversationId?, limit?, offset? (for conversations), cursor? (for steps: "createdAt,id").
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const conversationId = searchParams.get("conversationId")?.trim() || undefined;
  const limitParam = searchParams.get("limit");
  const offsetParam = searchParams.get("offset");
  const cursorParam = searchParams.get("cursor");

  if (conversationId) {
    const limit = Math.min(
      limitParam ? parseInt(limitParam, 10) : DEFAULT_STEPS_LIMIT,
      MAX_STEPS_LIMIT
    );
    const limitSafe = Math.max(1, Number.isNaN(limit) ? DEFAULT_STEPS_LIMIT : limit);
    let cursorCreatedAt: number | null = null;
    let cursorId: string | null = null;
    if (cursorParam) {
      const parts = cursorParam.split(",");
      if (parts.length >= 2) {
        const parsed = parseInt(parts[0], 10);
        if (!Number.isNaN(parsed)) cursorCreatedAt = parsed;
        if (parts[1]) cursorId = parts[1];
      }
    }

    const baseWhere = eq(messageQueueLog.conversationId, conversationId);
    const cursorWhere =
      cursorCreatedAt != null && cursorId != null
        ? or(
            gt(messageQueueLog.createdAt, cursorCreatedAt),
            and(
              eq(messageQueueLog.createdAt, cursorCreatedAt),
              gt(messageQueueLog.id, cursorId)
            )
          )
        : undefined;

    const rows = await db
      .select()
      .from(messageQueueLog)
      .where(cursorWhere ? and(baseWhere, cursorWhere) : baseWhere)
      .orderBy(asc(messageQueueLog.createdAt), asc(messageQueueLog.id))
      .limit(limitSafe + 1);

    const steps: MessageQueueLogEntry[] = rows.slice(0, limitSafe).map((r) => ({
      id: r.id,
      type: r.type,
      phase: r.phase ?? null,
      label: r.label ?? null,
      payload: r.payload ?? null,
      createdAt: r.createdAt,
    }));
    const hasMore = rows.length > limitSafe;
    const last = steps[steps.length - 1];
    const nextCursor =
      hasMore && last
        ? `${last.createdAt},${last.id}`
        : null;

    return json({ steps, nextCursor });
  }

  const limit = Math.min(
    limitParam ? parseInt(limitParam, 10) : DEFAULT_CONVERSATIONS_LIMIT,
    100
  );
  const offset = offsetParam ? parseInt(offsetParam, 10) : 0;
  const limitSafe = Math.max(1, Number.isNaN(limit) ? DEFAULT_CONVERSATIONS_LIMIT : limit);
  const offsetSafe = Math.max(0, Number.isNaN(offset) ? 0 : offset);

  const rows = await db
    .select({
      conversationId: messageQueueLog.conversationId,
      lastAt: sql<number>`max(${messageQueueLog.createdAt})`.as("lastAt"),
      stepCount: sql<number>`count(*)`.mapWith(Number).as("stepCount"),
    })
    .from(messageQueueLog)
    .groupBy(messageQueueLog.conversationId)
    .orderBy(desc(sql`max(${messageQueueLog.createdAt})`))
    .limit(limitSafe + 1)
    .offset(offsetSafe);

  const conversations = rows.slice(0, limitSafe).map((r) => ({
    conversationId: r.conversationId,
    lastAt: r.lastAt ?? 0,
    stepCount: r.stepCount ?? 0,
  }));
  const hasMore = rows.length > limitSafe;
  const nextOffset = hasMore ? offsetSafe + limitSafe : null;

  return json({
    conversations,
    nextOffset,
  });
}
