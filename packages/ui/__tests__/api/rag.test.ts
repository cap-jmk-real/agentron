import { describe, it, expect, beforeAll } from "vitest";
import { GET as encListGet, POST as encPost } from "../../app/api/rag/encoding-config/route";
import { GET as encGet, PUT as encPut, DELETE as encDelete } from "../../app/api/rag/encoding-config/[id]/route";
import { GET as storeListGet, POST as storePost } from "../../app/api/rag/document-store/route";
import { GET as storeGet, PUT as storePut, DELETE as storeDelete } from "../../app/api/rag/document-store/[id]/route";
import { GET as collListGet, POST as collPost } from "../../app/api/rag/collections/route";
import { GET as collGet, PUT as collPut, DELETE as collDelete } from "../../app/api/rag/collections/[id]/route";

describe("RAG encoding config API", () => {
  let id: string;

  it("GET /api/rag/encoding-config returns array", async () => {
    const res = await encListGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("POST /api/rag/encoding-config creates config", async () => {
    const res = await encPost(
      new Request("http://localhost/api/rag/encoding-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "OpenAI small",
          provider: "openai",
          modelOrEndpoint: "text-embedding-3-small",
          dimensions: 1536,
        }),
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.name).toBe("OpenAI small");
    expect(data.dimensions).toBe(1536);
    id = data.id;
  });

  it("GET /api/rag/encoding-config/:id returns config", async () => {
    const res = await encGet(new Request("http://localhost/x"), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(id);
    expect(data.name).toBe("OpenAI small");
  });

  it("PUT /api/rag/encoding-config/:id updates config", async () => {
    const res = await encPut(
      new Request("http://localhost/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dimensions: 768 }),
      }),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.dimensions).toBe(768);
  });

  it("GET /api/rag/encoding-config/:id returns 404 for unknown id", async () => {
    const res = await encGet(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "non-existent-rag-enc-123" }),
    });
    expect(res.status).toBe(404);
  });

  it("DELETE /api/rag/encoding-config/:id removes config", async () => {
    const res = await encDelete(new Request("http://localhost/x", { method: "DELETE" }), {
      params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
    const getRes = await encGet(new Request("http://localhost/x"), { params: Promise.resolve({ id }) });
    expect(getRes.status).toBe(404);
  });
});

describe("RAG document store API", () => {
  let id: string;

  it("GET /api/rag/document-store returns array", async () => {
    const res = await storeListGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("POST /api/rag/document-store creates store", async () => {
    const res = await storePost(
      new Request("http://localhost/api/rag/document-store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "MinIO local",
          type: "minio",
          bucket: "agentron-docs",
          endpoint: "http://minio:9000",
        }),
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.name).toBe("MinIO local");
    expect(data.bucket).toBe("agentron-docs");
    expect(data.endpoint).toBe("http://minio:9000");
    id = data.id;
  });

  it("GET /api/rag/document-store/:id returns store", async () => {
    const res = await storeGet(new Request("http://localhost/x"), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(id);
  });

  it("PUT /api/rag/document-store/:id updates store", async () => {
    const res = await storePut(
      new Request("http://localhost/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucket: "agentron-docs-v2" }),
      }),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.bucket).toBe("agentron-docs-v2");
  });

  it("DELETE /api/rag/document-store/:id removes store", async () => {
    const res = await storeDelete(new Request("http://localhost/x", { method: "DELETE" }), {
      params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
    const getRes = await storeGet(new Request("http://localhost/x"), { params: Promise.resolve({ id }) });
    expect(getRes.status).toBe(404);
  });
});

describe("RAG collections API", () => {
  let encId: string;
  let storeId: string;
  let collId: string;

  beforeAll(async () => {
    const encRes = await encPost(
      new Request("http://localhost/api/rag/encoding-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Enc for collections",
          provider: "openai",
          modelOrEndpoint: "text-embedding-3-small",
          dimensions: 1536,
        }),
      })
    );
    const enc = await encRes.json();
    encId = enc.id;

    const storeRes = await storePost(
      new Request("http://localhost/api/rag/document-store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Store for collections",
          type: "minio",
          bucket: "agentron-docs",
        }),
      })
    );
    const store = await storeRes.json();
    storeId = store.id;
  });

  it("GET /api/rag/collections returns array", async () => {
    const res = await collListGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("POST /api/rag/collections creates deployment-wide collection", async () => {
    const res = await collPost(
      new Request("http://localhost/api/rag/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Deployment knowledge",
          scope: "deployment",
          encodingConfigId: encId,
          documentStoreId: storeId,
        }),
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.scope).toBe("deployment");
    expect(data.agentId).toBeUndefined();
    collId = data.id;
  });

  it("GET /api/rag/collections/:id returns collection", async () => {
    const res = await collGet(new Request("http://localhost/x"), { params: Promise.resolve({ id: collId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(collId);
    expect(data.scope).toBe("deployment");
  });

  it("PUT /api/rag/collections/:id updates collection", async () => {
    const res = await collPut(
      new Request("http://localhost/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Deployment knowledge (updated)" }),
      }),
      { params: Promise.resolve({ id: collId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("Deployment knowledge (updated)");
  });

  it("DELETE /api/rag/collections/:id removes collection", async () => {
    const res = await collDelete(new Request("http://localhost/x", { method: "DELETE" }), {
      params: Promise.resolve({ id: collId }) },
    );
    expect(res.status).toBe(200);
    const getRes = await collGet(new Request("http://localhost/x"), { params: Promise.resolve({ id: collId }) });
    expect(getRes.status).toBe(404);
  });
});
