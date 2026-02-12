import { describe, it, expect } from "vitest";
import { GET as listGet, POST as listPost } from "../../app/api/chat/conversations/route";

describe("Chat conversations API", () => {
  it("GET /api/chat/conversations returns array", async () => {
    const res = await listGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("POST /api/chat/conversations creates conversation", async () => {
    const res = await listPost(
      new Request("http://localhost/api/chat/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Test Chat" }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.title).toBe("Test Chat");
  });

  it("POST /api/chat/conversations with empty body creates with null title", async () => {
    const res = await listPost(
      new Request("http://localhost/api/chat/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBeDefined();
  });
});
