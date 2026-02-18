import { json } from "../../_lib/response";
import { db, chatMessages, conversations } from "../../_lib/db";
import { eq, desc } from "drizzle-orm";

/** Returns count and list of conversations where the Chat assistant is waiting for user input (ask_user, format_response with needsInput). */
export async function GET() {
  const rows = await db
    .select({ conversationId: chatMessages.conversationId, role: chatMessages.role, toolCalls: chatMessages.toolCalls })
    .from(chatMessages)
    .where(eq(chatMessages.role, "assistant"))
    .orderBy(desc(chatMessages.createdAt))
    .limit(300);

  const seen = new Set<string | null>();
  const pending: { conversationId: string; title: string | null }[] = [];

  for (const row of rows) {
    const cid = row.conversationId;
    if (!cid || seen.has(cid)) continue;
    seen.add(cid);

    const toolCalls = parseToolCalls(row.toolCalls);
    if (!hasWaitingForInput(toolCalls)) continue;

    const convRows = await db
      .select({ title: conversations.title })
      .from(conversations)
      .where(eq(conversations.id, cid))
      .limit(1);
    const title = convRows[0]?.title ?? null;
    pending.push({ conversationId: cid, title });
  }

  return json({ count: pending.length, conversations: pending });
}

function parseToolCalls(raw: string | null): { name: string; result?: unknown }[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p): p is { name?: string; result?: unknown } => p != null && typeof p === "object")
      .map((p) => ({ name: typeof p.name === "string" ? p.name : "", result: p.result }));
  } catch {
    return [];
  }
}

function hasWaitingForInput(toolResults: { name: string; result?: unknown }[]): boolean {
  return toolResults.some((r) => {
    if (r.name === "ask_user" || r.name === "ask_credentials") {
      const res = r.result;
      if (!res || typeof res !== "object") return false;
      const obj = res as Record<string, unknown>;
      if (obj.waitingForUser === true) return true;
      if (Array.isArray(obj.options) && obj.options.length > 0) return true;
      return false;
    }
    if (r.name === "format_response") {
      const res = r.result;
      if (!res || typeof res !== "object") return false;
      const obj = res as { formatted?: boolean; needsInput?: string };
      if (obj.formatted !== true) return false;
      if (typeof obj.needsInput === "string" && obj.needsInput.trim()) return true;
      return false;
    }
    return false;
  });
}
