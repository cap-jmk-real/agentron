import { describe, it, expect } from "vitest";
import { GET as listGet, POST as listPost } from "../../app/api/rag/connectors/route";
import {
  GET as connGet,
  PUT as connPut,
  DELETE as connDelete,
} from "../../app/api/rag/connectors/[id]/route";
import { POST as collPost } from "../../app/api/rag/collections/route";
import { POST as encPost } from "../../app/api/rag/encoding-config/route";
import { POST as storePost } from "../../app/api/rag/document-store/route";

describe("RAG connectors API", () => {
  let collectionId: string;
  let connectorId: string;

  it("GET /api/rag/connectors returns array", async () => {
    const res = await listGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("POST /api/rag/connectors returns 400 for invalid JSON", async () => {
    const res = await listPost(
      new Request("http://localhost/api/rag/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      })
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/rag/connectors creates connector", async () => {
    const encRes = await encPost(
      new Request("http://localhost/api/rag/encoding-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Conn enc",
          provider: "openai",
          modelOrEndpoint: "text-embedding-3-small",
          dimensions: 1536,
        }),
      })
    );
    const enc = await encRes.json();
    const storeRes = await storePost(
      new Request("http://localhost/api/rag/document-store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Conn store",
          type: "minio",
          bucket: "b",
          endpoint: "http://localhost:9000",
        }),
      })
    );
    const store = await storeRes.json();
    const collRes = await collPost(
      new Request("http://localhost/api/rag/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Conn coll",
          scope: "agent",
          encodingConfigId: enc.id,
          documentStoreId: store.id,
        }),
      })
    );
    const coll = await collRes.json();
    collectionId = coll.id;

    const res = await listPost(
      new Request("http://localhost/api/rag/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "filesystem",
          collectionId,
          config: { path: "/tmp" },
        }),
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeDefined();
    connectorId = data.id;
    expect(data.collectionId).toBe(collectionId);
  });

  it("GET /api/rag/connectors/:id returns 404 for unknown id", async () => {
    const res = await connGet(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "non-existent-connector-id" }),
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain("Not found");
  });

  it("GET /api/rag/connectors/:id returns connector", async () => {
    const res = await connGet(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: connectorId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(connectorId);
    expect(data.type).toBe("filesystem");
    expect(data.collectionId).toBe(collectionId);
  });

  it("PUT /api/rag/connectors/:id returns 400 for invalid JSON", async () => {
    const res = await connPut(
      new Request("http://localhost/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      }),
      { params: Promise.resolve({ id: connectorId }) }
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("PUT /api/rag/connectors/:id returns 404 for unknown id", async () => {
    const res = await connPut(
      new Request("http://localhost/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "syncing" }),
      }),
      { params: Promise.resolve({ id: "non-existent-connector-id" }) }
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain("Not found");
  });

  it("PUT /api/rag/connectors/:id updates connector", async () => {
    const res = await connPut(
      new Request("http://localhost/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "syncing" }),
      }),
      { params: Promise.resolve({ id: connectorId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("syncing");
  });

  it("DELETE /api/rag/connectors/:id returns 404 for unknown id", async () => {
    const res = await connDelete(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "non-existent-connector-id" }),
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain("Not found");
  });

  it("DELETE /api/rag/connectors/:id removes connector", async () => {
    const res = await connDelete(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: connectorId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    const getRes = await connGet(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: connectorId }),
    });
    expect(getRes.status).toBe(404);
  });
});
