import { describe, it, expect } from "vitest";
import { POST } from "../../app/api/rag/retrieve/route";

describe("RAG retrieve API", () => {
  it("POST /api/rag/retrieve returns 400 for invalid JSON", async () => {
    const res = await POST(
      new Request("http://localhost/api/rag/retrieve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("POST /api/rag/retrieve returns chunks array (empty when no deployment collection)", async () => {
    const res = await POST(
      new Request("http://localhost/api/rag/retrieve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "test query" }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("chunks");
    expect(Array.isArray(data.chunks)).toBe(true);
  });

  it("POST /api/rag/retrieve respects limit", async () => {
    const res = await POST(
      new Request("http://localhost/api/rag/retrieve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "test", limit: 3 }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.chunks.length).toBeLessThanOrEqual(3);
  });
});
