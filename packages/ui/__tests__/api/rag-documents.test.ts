import { describe, it, expect } from "vitest";
import { GET } from "../../app/api/rag/documents/route";

describe("RAG documents API", () => {
  it("GET /api/rag/documents returns 400 when collectionId missing", async () => {
    const res = await GET(new Request("http://localhost/api/rag/documents"));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("collectionId");
  });

  it("GET /api/rag/documents?collectionId=some-id returns array", async () => {
    const res = await GET(new Request("http://localhost/api/rag/documents?collectionId=some-collection-id"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });
});
