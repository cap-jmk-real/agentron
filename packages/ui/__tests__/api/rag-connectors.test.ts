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

  it("GET /api/rag/connectors returns each connector with id, type, collectionId, config, status, lastSyncAt, createdAt", async () => {
    const res = await listGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    for (const c of data as {
      id: string;
      type: string;
      collectionId: string;
      config: unknown;
      status: string;
      lastSyncAt?: number;
      createdAt: number;
    }[]) {
      expect(c).toHaveProperty("id");
      expect(c).toHaveProperty("type");
      expect(c).toHaveProperty("collectionId");
      expect(c).toHaveProperty("config");
      expect(c).toHaveProperty("status");
      expect(c).toHaveProperty("createdAt");
    }
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

  it("POST /api/rag/connectors with optional id uses provided id", async () => {
    const encRes = await encPost(
      new Request("http://localhost/api/rag/encoding-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Enc for id",
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
          name: "Store for id",
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
          name: "Coll for id",
          scope: "agent",
          encodingConfigId: enc.id,
          documentStoreId: store.id,
        }),
      })
    );
    const coll = await collRes.json();
    const customId = "custom-connector-id-" + Date.now();
    const res = await listPost(
      new Request("http://localhost/api/rag/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: customId,
          type: "filesystem",
          collectionId: coll.id,
          config: { path: "/tmp" },
        }),
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBe(customId);
  });

  it("GET /api/rag/connectors returns lastError when config has lastError string", async () => {
    const encRes = await encPost(
      new Request("http://localhost/api/rag/encoding-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Enc lastErr",
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
          name: "Store lastErr",
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
          name: "Coll lastErr",
          scope: "agent",
          encodingConfigId: enc.id,
          documentStoreId: store.id,
        }),
      })
    );
    const coll = await collRes.json();
    await listPost(
      new Request("http://localhost/api/rag/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "filesystem",
          collectionId: coll.id,
          config: { path: "/tmp", lastError: "sync failed" },
        }),
      })
    );
    const listRes = await listGet();
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    const withError = list.find(
      (c: { config: { lastError?: string } }) => c.config?.lastError === "sync failed"
    );
    expect(withError).toBeDefined();
    expect(withError.lastError).toBe("sync failed");
  });

  it("GET /api/rag/connectors returns lastError undefined when config.lastError is not string", async () => {
    const encRes = await encPost(
      new Request("http://localhost/api/rag/encoding-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Enc noLastErr",
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
          name: "Store noLastErr",
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
          name: "Coll noLastErr",
          scope: "agent",
          encodingConfigId: enc.id,
          documentStoreId: store.id,
        }),
      })
    );
    const coll = await collRes.json();
    await listPost(
      new Request("http://localhost/api/rag/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "filesystem",
          collectionId: coll.id,
          config: { lastError: 999 },
        }),
      })
    );
    const listRes = await listGet();
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    const withNonString = list.find(
      (c: { config: { lastError?: unknown } }) => c.config && c.config.lastError === 999
    );
    expect(withNonString).toBeDefined();
    expect(withNonString.lastError).toBeUndefined();
  });

  it("POST /api/rag/connectors persists config.ingestAfterSync and GET :id returns it", async () => {
    const encRes = await encPost(
      new Request("http://localhost/api/rag/encoding-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Enc ingestOpt",
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
          name: "Store ingestOpt",
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
          name: "Coll ingestOpt",
          scope: "agent",
          encodingConfigId: enc.id,
          documentStoreId: store.id,
        }),
      })
    );
    const coll = await collRes.json();
    const postRes = await listPost(
      new Request("http://localhost/api/rag/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "filesystem",
          collectionId: coll.id,
          config: { path: "/tmp", ingestAfterSync: true },
        }),
      })
    );
    expect(postRes.status).toBe(201);
    const created = await postRes.json();
    const getRes = await connGet(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(getRes.status).toBe(200);
    const data = await getRes.json();
    expect(data.config).toEqual(expect.objectContaining({ path: "/tmp", ingestAfterSync: true }));
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

  it("GET /api/rag/connectors/:id returns connector with id, type, collectionId, config, status, lastSyncAt, createdAt", async () => {
    const res = await connGet(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: connectorId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(connectorId);
    expect(data.type).toBe("filesystem");
    expect(data.collectionId).toBe(collectionId);
    expect(data).toHaveProperty("config");
    expect(data).toHaveProperty("status");
    expect(data).toHaveProperty("createdAt");
    // lastSyncAt may be omitted when never synced (route returns undefined → omitted in JSON)
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

  it("PUT /api/rag/connectors/:id with empty body returns 200 and connector unchanged", async () => {
    const before = await connGet(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: connectorId }),
    });
    const beforeData = await before.json();
    const res = await connPut(
      new Request("http://localhost/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: connectorId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(beforeData.id);
    expect(data.type).toBe(beforeData.type);
    expect(data.collectionId).toBe(beforeData.collectionId);
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
