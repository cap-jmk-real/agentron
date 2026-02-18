import path from "node:path";
import fs from "node:fs";
import { getDataDir } from "./db";

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

const FILENAME = "notifications.json";

function getPath(): string {
  return path.join(getDataDir(), FILENAME);
}

function load(): Notification[] {
  const p = getPath();
  if (!fs.existsSync(p)) return [];
  try {
    const raw = fs.readFileSync(p, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data.items) ? (data.items as Notification[]) : [];
  } catch {
    return [];
  }
}

function save(items: Notification[]): void {
  const p = getPath();
  fs.writeFileSync(p, JSON.stringify({ items }, null, 2), "utf-8");
}

/** List notifications with optional filters. Returns active count for badge. */
export function listNotifications(options: {
  status?: NotificationStatus;
  types?: NotificationType[];
  limit?: number;
  offset?: number;
}): { items: Notification[]; totalActiveCount: number } {
  const { status = "active", types, limit = 50, offset = 0 } = options;
  const all = load();
  const totalActiveCount = all.filter((n) => n.status === "active").length;
  let filtered = status ? all.filter((n) => n.status === status) : all;
  if (types && types.length > 0) {
    filtered = filtered.filter((n) => types.includes(n.type));
  }
  filtered.sort((a, b) => b.createdAt - a.createdAt);
  const items = filtered.slice(offset, offset + limit);
  return { items, totalActiveCount };
}

/** Mark one notification as cleared. Idempotent. */
export function clearOne(id: string): boolean {
  const all = load();
  const idx = all.findIndex((n) => n.id === id);
  if (idx === -1) return false;
  if (all[idx].status === "cleared") return true;
  const now = Date.now();
  all[idx] = { ...all[idx], status: "cleared" as const, updatedAt: now };
  save(all);
  return true;
}

/** Mark multiple notifications as cleared by id. Idempotent. */
export function clearBulk(ids: string[]): number {
  if (ids.length === 0) return 0;
  const all = load();
  const idSet = new Set(ids);
  let count = 0;
  const now = Date.now();
  for (let i = 0; i < all.length; i++) {
    if (idSet.has(all[i].id) && all[i].status === "active") {
      all[i] = { ...all[i], status: "cleared" as const, updatedAt: now };
      count++;
    }
  }
  if (count > 0) save(all);
  return count;
}

/** Clear all active notifications, optionally filtered by type. */
export function clearAll(types?: NotificationType[]): number {
  const all = load();
  const now = Date.now();
  let count = 0;
  for (let i = 0; i < all.length; i++) {
    if (all[i].status !== "active") continue;
    if (types && types.length > 0 && !types.includes(all[i].type)) continue;
    all[i] = { ...all[i], status: "cleared" as const, updatedAt: now };
    count++;
  }
  if (count > 0) save(all);
  return count;
}

/** Clear active notifications with the given type and sourceId (e.g. one "chat needs input" per conversation). */
export function clearActiveBySourceId(type: NotificationType, sourceId: string): number {
  const all = load();
  const now = Date.now();
  let count = 0;
  for (let i = 0; i < all.length; i++) {
    if (all[i].status !== "active" || all[i].type !== type || all[i].sourceId !== sourceId) continue;
    all[i] = { ...all[i], status: "cleared" as const, updatedAt: now };
    count++;
  }
  if (count > 0) save(all);
  return count;
}

/** Create a new notification (used by run/chat event wiring). */
export function createNotification(entry: {
  type: NotificationType;
  sourceId: string;
  title: string;
  message?: string;
  severity?: NotificationSeverity;
  metadata?: Record<string, unknown>;
}): Notification {
  const now = Date.now();
  const n: Notification = {
    id: crypto.randomUUID(),
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
  const all = load();
  all.unshift(n);
  save(all);
  return n;
}

/** Create a run notification when status becomes completed, failed, or waiting_for_user. */
export function createRunNotification(
  runId: string,
  status: "completed" | "failed" | "waiting_for_user",
  metadata?: { targetType?: string; targetId?: string }
): Notification {
  const titles: Record<string, string> = {
    completed: "Run completed",
    failed: "Run failed",
    waiting_for_user: "Run needs your input",
  };
  const severity: NotificationSeverity = status === "failed" ? "error" : status === "waiting_for_user" ? "warning" : "success";
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
export function createChatNotification(conversationId: string): Notification {
  clearActiveBySourceId("chat", conversationId);
  return createNotification({
    type: "chat",
    sourceId: conversationId,
    title: "Chat needs your input",
    message: "Open the conversation to reply.",
    severity: "warning",
    metadata: { conversationId },
  });
}
