import { describe, it, expect } from "vitest";
import { GET } from "../../app/api/chat/pending-input/route";

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
});
