import { eq, and, inArray, desc, sql } from "drizzle-orm";
import { db, notificationsTable } from "./db";

export type NotificationType = "run" | "chat" | "system";
export type NotificationSeverity = "info" | "success" | "warning" | "error";
export type NotificationStatus = "active" | "cleared";

export type Notification = {
  id: string;
  type: NotificationType;
  sourceId: string;
  title: string;
  message: string;
  severity: NotificationSeverity;
  status: NotificationStatus;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
};

function rowToNotification(row: Record<string, unknown>): Notification {
  const id = String(row.id ?? "");
  const type = String(row.type ?? "");
  const sourceId = String(
    (row as { sourceId?: string }).sourceId ?? (row as { source_id?: string }).source_id ?? ""
  );
  const title = String(row.title ?? "");
  const message = String(row.message ?? "");
  const severity = String(row.severity ?? "info");
  const status = String(row.status ?? "active");
  const createdAt = Number(
    (row as { createdAt?: number }).createdAt ?? (row as { created_at?: number }).created_at ?? 0
  );
  const updatedAt = Number(
    (row as { updatedAt?: number }).updatedAt ?? (row as { updated_at?: number }).updated_at ?? 0
  );
  const rawMeta = row.metadata ?? (row as { metadata?: string }).metadata;
  let metadata: Record<string, unknown> | undefined;
  if (rawMeta != null && rawMeta !== "") {
    try {
      metadata = JSON.parse(String(rawMeta)) as Record<string, unknown>;
    } catch {
      metadata = undefined;
    }
  }
  return {
    id,
    type: type as NotificationType,
    sourceId,
    title,
    message,
    severity: severity as NotificationSeverity,
    status: status as NotificationStatus,
    createdAt,
    updatedAt,
    metadata,
  };
}

/** List notifications with optional filters. Returns active count for badge. */
export async function listNotifications(options: {
  status?: NotificationStatus;
  types?: NotificationType[];
  limit?: number;
  offset?: number;
}): Promise<{ items: Notification[]; totalActiveCount: number }> {
  const { status = "active", types, limit = 50, offset = 0 } = options;

  const conditions = [eq(notificationsTable.status, status)];
  if (types && types.length > 0) {
    conditions.push(inArray(notificationsTable.type, types));
  }
  const where = conditions.length === 1 ? conditions[0] : and(...conditions);

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(notificationsTable)
    .where(eq(notificationsTable.status, "active"));
  const totalActiveCount = Number(totalRow?.count ?? 0);

  const rows = await db
    .select()
    .from(notificationsTable)
    .where(where)
    .orderBy(desc(notificationsTable.createdAt))
    .limit(limit)
    .offset(offset);

  const items = rows.map(rowToNotification);
  return { items, totalActiveCount };
}

/** Mark one notification as cleared. Idempotent. */
export async function clearOne(id: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.id, id))
    .limit(1);
  if (!row) return false;
  if (row.status === "cleared") return true;
  const now = Date.now();
  await db
    .update(notificationsTable)
    .set({ status: "cleared", updatedAt: now })
    .where(eq(notificationsTable.id, id))
    .run();
  return true;
}

/** Mark multiple notifications as cleared by id. Idempotent. */
export async function clearBulk(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(notificationsTable)
    .where(and(eq(notificationsTable.status, "active"), inArray(notificationsTable.id, ids)));
  const count = Number(countRow?.count ?? 0);
  if (count === 0) return 0;
  const now = Date.now();
  await db
    .update(notificationsTable)
    .set({ status: "cleared", updatedAt: now })
    .where(and(eq(notificationsTable.status, "active"), inArray(notificationsTable.id, ids)))
    .run();
  return count;
}

/** Clear all active notifications, optionally filtered by type. */
export async function clearAll(types?: NotificationType[]): Promise<number> {
  const where =
    types && types.length > 0
      ? and(eq(notificationsTable.status, "active"), inArray(notificationsTable.type, types))
      : eq(notificationsTable.status, "active");
  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(notificationsTable)
    .where(where);
  const count = Number(countRow?.count ?? 0);
  if (count === 0) return 0;
  const now = Date.now();
  await db.update(notificationsTable).set({ status: "cleared", updatedAt: now }).where(where).run();
  return count;
}

/** Clear active notifications with the given type and sourceId (e.g. one "chat needs input" per conversation). */
export async function clearActiveBySourceId(
  type: NotificationType,
  sourceId: string
): Promise<number> {
  const where = and(
    eq(notificationsTable.status, "active"),
    eq(notificationsTable.type, type),
    eq(notificationsTable.sourceId, sourceId)
  );
  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(notificationsTable)
    .where(where);
  const count = Number(countRow?.count ?? 0);
  if (count === 0) return 0;
  const now = Date.now();
  await db.update(notificationsTable).set({ status: "cleared", updatedAt: now }).where(where).run();
  return count;
}

/** Create a new notification (used by run/chat event wiring). */
export async function createNotification(entry: {
  type: NotificationType;
  sourceId: string;
  title: string;
  message?: string;
  severity?: NotificationSeverity;
  metadata?: Record<string, unknown>;
}): Promise<Notification> {
  const now = Date.now();
  const id = crypto.randomUUID();
  const metadataJson = entry.metadata != null ? JSON.stringify(entry.metadata) : null;
  await db
    .insert(notificationsTable)
    .values({
      id,
      type: entry.type,
      sourceId: entry.sourceId,
      title: entry.title,
      message: entry.message ?? "",
      severity: entry.severity ?? "info",
      status: "active",
      createdAt: now,
      updatedAt: now,
      metadata: metadataJson,
    })
    .run();
  return {
    id,
    type: entry.type,
    sourceId: entry.sourceId,
    title: entry.title,
    message: entry.message ?? "",
    severity: entry.severity ?? "info",
    status: "active",
    createdAt: now,
    updatedAt: now,
    metadata: entry.metadata,
  };
}

/** Create a run notification when status becomes completed, failed, or waiting_for_user. */
export async function createRunNotification(
  runId: string,
  status: "completed" | "failed" | "waiting_for_user",
  metadata?: { targetType?: string; targetId?: string }
): Promise<Notification> {
  const titles: Record<string, string> = {
    completed: "Run completed",
    failed: "Run failed",
    waiting_for_user: "Run needs your input",
  };
  const severity: NotificationSeverity =
    status === "failed" ? "error" : status === "waiting_for_user" ? "warning" : "success";
  return createNotification({
    type: "run",
    sourceId: runId,
    title: titles[status] ?? "Run updated",
    message: "",
    severity,
    metadata: metadata ?? {},
  });
}

/** Create a chat notification when a conversation is waiting for user input (ask_user / ask_credentials / format_response). Replaces any existing active chat notification for this conversation. */
export async function createChatNotification(conversationId: string): Promise<Notification> {
  await clearActiveBySourceId("chat", conversationId);
  return createNotification({
    type: "chat",
    sourceId: conversationId,
    title: "Chat needs your input",
    message: "Open the conversation to reply.",
    severity: "info",
    metadata: { conversationId },
  });
}
