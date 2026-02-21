import { describe, it, expect } from "vitest";
import { GET } from "../../app/api/chat/pending-input/route";
import { db, chatMessages, conversations } from "../../app/api/_lib/db";
import { eq } from "drizzle-orm";

describe("Chat pending-input API", () => {
  it("GET /api/chat/pending-input returns count and conversations array", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.count).toBe("number");
    expect(Array.isArray(data.conversations)).toBe(true);
    data.conversations.forEach((c: { conversationId: string; title: string | null }) => {
      expect(typeof c.conversationId).toBe("string");
    });
  });

  it("GET /api/chat/pending-input includes conversation when assistant has ask_user with waitingForUser", async () => {
    const convId = "pending-ask-user-" + Date.now();
    const msgId = "msg-ask-" + Date.now();
    const now = Date.now();
    await db
      .insert(conversations)
      .values({ id: convId, title: "Pending Ask", createdAt: now })
      .run();
    await db
      .insert(chatMessages)
      .values({
        id: msgId,
        conversationId: convId,
        role: "assistant",
        content: "",
        toolCalls: JSON.stringify([{ name: "ask_user", result: { waitingForUser: true } }]),
        createdAt: now,
      })
      .run();
    try {
      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.count).toBeGreaterThanOrEqual(1);
      const found = data.conversations.find(
        (c: { conversationId: string }) => c.conversationId === convId
      );
      expect(found).toBeDefined();
      expect(found.title).toBe("Pending Ask");
    } finally {
      await db.delete(chatMessages).where(eq(chatMessages.id, msgId)).run();
      await db.delete(conversations).where(eq(conversations.id, convId)).run();
    }
  });

  it("GET /api/chat/pending-input includes conversation when assistant has format_response with needsInput", async () => {
    const convId = "pending-format-" + Date.now();
    const msgId = "msg-format-" + Date.now();
    const now = Date.now();
    await db.insert(conversations).values({ id: convId, title: null, createdAt: now }).run();
    await db
      .insert(chatMessages)
      .values({
        id: msgId,
        conversationId: convId,
        role: "assistant",
        content: "",
        toolCalls: JSON.stringify([
          { name: "format_response", result: { formatted: true, needsInput: "Choose one" } },
        ]),
        createdAt: now,
      })
      .run();
    try {
      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      const found = data.conversations.find(
        (c: { conversationId: string }) => c.conversationId === convId
      );
      expect(found).toBeDefined();
      expect(found.title).toBeNull();
    } finally {
      await db.delete(chatMessages).where(eq(chatMessages.id, msgId)).run();
      await db.delete(conversations).where(eq(conversations.id, convId)).run();
    }
  });
});
