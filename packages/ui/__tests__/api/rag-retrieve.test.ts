import { describe, it, expect, vi } from "vitest";
import { POST } from "../../app/api/rag/retrieve/route";
import * as rag from "../../app/api/_lib/rag";

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

  it("POST /api/rag/retrieve clamps limit to 1-20", async () => {
    const resLow = await POST(
      new Request("http://localhost/api/rag/retrieve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "x", limit: 0 }),
      })
    );
    expect(resLow.status).toBe(200);
    const resHigh = await POST(
      new Request("http://localhost/api/rag/retrieve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "x", limit: 99 }),
      })
    );
    expect(resHigh.status).toBe(200);
    const dataHigh = await resHigh.json();
    expect(dataHigh.chunks.length).toBeLessThanOrEqual(20);
  });

  it("POST /api/rag/retrieve with collectionId uses provided collection", async () => {
    const res = await POST(
      new Request("http://localhost/api/rag/retrieve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionId: "test-collection-id",
          query: "test",
          limit: 5,
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("chunks");
    expect(Array.isArray(data.chunks)).toBe(true);
  });

  it("POST /api/rag/retrieve returns chunks [] when no deployment collection", async () => {
    vi.spyOn(rag, "getDeploymentCollectionId").mockResolvedValue(null);
    const res = await POST(
      new Request("http://localhost/api/rag/retrieve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "anything" }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.chunks).toEqual([]);
    vi.restoreAllMocks();
  });

  it("POST /api/rag/retrieve treats non-string query as empty string", async () => {
    const res = await POST(
      new Request("http://localhost/api/rag/retrieve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: 123, limit: 5 }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("chunks");
    expect(Array.isArray(data.chunks)).toBe(true);
  });

  it("POST /api/rag/retrieve uses effective limit from getEffectiveRagRetrieveLimit when limit omitted (chat scope)", async () => {
    vi.spyOn(rag, "getDeploymentCollectionId").mockResolvedValue("deploy-coll-id");
    const res = await POST(
      new Request("http://localhost/api/rag/retrieve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "test" }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("chunks");
    expect(Array.isArray(data.chunks)).toBe(true);
    vi.restoreAllMocks();
  });
});
