import { describe, it, expect } from "vitest";
import { GET } from "../../app/api/chat/route";
import { POST as convPost } from "../../app/api/chat/conversations/route";

describe("Chat API", () => {
  it("GET /api/chat returns messages array", async () => {
    const res = await GET(new Request("http://localhost/api/chat"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("GET /api/chat?conversationId=id returns messages for conversation", async () => {
    const createRes = await convPost(
      new Request("http://localhost/api/chat/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Chat get test" }),
      })
    );
    const conv = await createRes.json();
    const res = await GET(new Request(`http://localhost/api/chat?conversationId=${conv.id}`));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });
});
