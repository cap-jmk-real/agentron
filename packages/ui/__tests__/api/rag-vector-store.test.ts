import { describe, it, expect } from "vitest";
import { GET as listGet, POST as listPost } from "../../app/api/rag/vector-store/route";
import { GET as getOne, PUT as putOne, DELETE as deleteOne } from "../../app/api/rag/vector-store/[id]/route";

describe("RAG vector-store API", () => {
  let createdId: string;

  it("GET /api/rag/vector-store returns array", async () => {
    const res = await listGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("POST /api/rag/vector-store returns 400 for invalid JSON", async () => {
    const res = await listPost(
      new Request("http://localhost/api/rag/vector-store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      })
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/rag/vector-store creates store", async () => {
    const res = await listPost(
      new Request("http://localhost/api/rag/vector-store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Vector Store",
          type: "qdrant",
          config: { endpoint: "http://localhost:6333" },
        }),
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.name).toBe("Test Vector Store");
    expect(data.type).toBe("qdrant");
    createdId = data.id;
  });

  it("GET /api/rag/vector-store/:id returns 404 for unknown id", async () => {
    const res = await getOne(new Request("http://localhost/api/rag/vector-store/x"), {
      params: Promise.resolve({ id: "non-existent-vs-id" }),
    });
    expect(res.status).toBe(404);
  });

  it("GET /api/rag/vector-store/:id returns store", async () => {
    const res = await getOne(new Request("http://localhost/api/rag/vector-store/x"), {
      params: Promise.resolve({ id: createdId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(createdId);
  });

  it("PUT /api/rag/vector-store/:id updates store", async () => {
    const res = await putOne(
      new Request("http://localhost/api/rag/vector-store/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Updated Vector Store" }),
      }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("Updated Vector Store");
  });

  it("DELETE /api/rag/vector-store/:id removes store", async () => {
    const res = await deleteOne(
      new Request("http://localhost/api/rag/vector-store/x", { method: "DELETE" }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    const getRes = await getOne(new Request("http://localhost/api/rag/vector-store/x"), {
      params: Promise.resolve({ id: createdId }),
    });
    expect(getRes.status).toBe(404);
  });
});
