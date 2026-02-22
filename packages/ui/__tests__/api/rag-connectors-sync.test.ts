import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { POST } from "../../app/api/rag/connectors/[id]/sync/route";
import { GET as listGet, POST as listPost } from "../../app/api/rag/connectors/route";
import { POST as collPost } from "../../app/api/rag/collections/route";
import { POST as encPost } from "../../app/api/rag/encoding-config/route";
import { POST as storePost } from "../../app/api/rag/document-store/route";

describe("RAG connectors [id] sync API", () => {
  it("POST /api/rag/connectors/:id/sync returns 404 for non-existent connector", async () => {
    const res = await POST(
      new Request("http://localhost/api/rag/connectors/non-existent-id/sync", { method: "POST" }),
      {
        params: Promise.resolve({ id: "non-existent-id" }),
      }
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Connector not found");
  });

  it("POST /api/rag/connectors/:id/sync returns 404 when collection is missing", async () => {
    const res = await listPost(
      new Request("http://localhost/api/rag/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "filesystem",
          collectionId: "00000000-0000-0000-0000-000000000000",
          config: { path: os.tmpdir() },
        }),
      })
    );
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const syncRes = await POST(
      new Request(`http://localhost/api/rag/connectors/${id}/sync`, { method: "POST" }),
      { params: Promise.resolve({ id }) }
    );
    expect(syncRes.status).toBe(404);
    const data = await syncRes.json();
    expect(data.error).toBe("Collection not found");
  });

  it("POST /api/rag/connectors/:id/sync returns 400 for google_drive when serviceAccountKeyRef missing", async () => {
    const encRes = await encPost(
      new Request("http://localhost/api/rag/encoding-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Enc",
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
          name: "Store",
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
          name: "Coll",
          scope: "agent",
          encodingConfigId: enc.id,
          documentStoreId: store.id,
        }),
      })
    );
    const coll = await collRes.json();
    const connRes = await listPost(
      new Request("http://localhost/api/rag/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "google_drive",
          collectionId: coll.id,
          config: { folderId: "root" },
        }),
      })
    );
    expect(connRes.status).toBe(201);
    const { id } = await connRes.json();
    const syncRes = await POST(
      new Request(`http://localhost/api/rag/connectors/${id}/sync`, { method: "POST" }),
      { params: Promise.resolve({ id }) }
    );
    expect(syncRes.status).toBe(400);
    const data = await syncRes.json();
    expect(data.error).toContain("serviceAccountKeyRef");

    const listRes = await listGet();
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    const connector = list.find((c: { id: string }) => c.id === id);
    expect(connector).toBeDefined();
    expect(connector.lastError).toBeDefined();
    expect(connector.lastError).toContain("serviceAccountKeyRef");
  });

  it("POST /api/rag/connectors/:id/sync returns 400 for google_drive when env var has invalid JSON", async () => {
    const encRes = await encPost(
      new Request("http://localhost/api/rag/encoding-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Enc2",
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
          name: "Store2",
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
          name: "Coll2",
          scope: "agent",
          encodingConfigId: enc.id,
          documentStoreId: store.id,
        }),
      })
    );
    const coll = await collRes.json();
    const ref = "RAG_SYNC_TEST_INVALID_JSON";
    process.env[ref] = "not valid json";
    try {
      const connRes = await listPost(
        new Request("http://localhost/api/rag/connectors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "google_drive",
            collectionId: coll.id,
            config: { serviceAccountKeyRef: ref },
          }),
        })
      );
      expect(connRes.status).toBe(201);
      const { id } = await connRes.json();
      const syncRes = await POST(
        new Request(`http://localhost/api/rag/connectors/${id}/sync`, { method: "POST" }),
        { params: Promise.resolve({ id }) }
      );
      expect(syncRes.status).toBe(400);
      const data = await syncRes.json();
      expect(data.error).toContain("Invalid service account JSON");
    } finally {
      delete process.env[ref];
    }
  });

  it("POST /api/rag/connectors/:id/sync returns 400 for unknown connector type", async () => {
    const encRes = await encPost(
      new Request("http://localhost/api/rag/encoding-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Enc3",
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
          name: "Store3",
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
          name: "Coll3",
          scope: "agent",
          encodingConfigId: enc.id,
          documentStoreId: store.id,
        }),
      })
    );
    const coll = await collRes.json();
    const connRes = await listPost(
      new Request("http://localhost/api/rag/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "unknown_connector_type",
          collectionId: coll.id,
          config: {},
        }),
      })
    );
    expect(connRes.status).toBe(201);
    const { id } = await connRes.json();
    const syncRes = await POST(
      new Request(`http://localhost/api/rag/connectors/${id}/sync`, { method: "POST" }),
      { params: Promise.resolve({ id }) }
    );
    expect(syncRes.status).toBe(400);
    const data = await syncRes.json();
    expect(data.error).toContain("not implemented");
  });

  it("POST /api/rag/connectors/:id/sync returns 400 for filesystem when config.path missing", async () => {
    const encRes = await encPost(
      new Request("http://localhost/api/rag/encoding-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Enc4",
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
          name: "Store4",
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
          name: "Coll4",
          scope: "agent",
          encodingConfigId: enc.id,
          documentStoreId: store.id,
        }),
      })
    );
    const coll = await collRes.json();
    const connRes = await listPost(
      new Request("http://localhost/api/rag/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "filesystem",
          collectionId: coll.id,
          config: {},
        }),
      })
    );
    expect(connRes.status).toBe(201);
    const { id } = await connRes.json();
    const syncRes = await POST(
      new Request(`http://localhost/api/rag/connectors/${id}/sync`, { method: "POST" }),
      { params: Promise.resolve({ id }) }
    );
    expect(syncRes.status).toBe(400);
    const data = await syncRes.json();
    expect(data.error).toContain("config.path");
  });

  it("POST /api/rag/connectors/:id/sync returns 200 for filesystem with valid path", async () => {
    const tmpDir = path.resolve(path.join(os.tmpdir(), `rag-sync-test-${Date.now()}`));
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "test.txt"), "hello");
    fs.writeFileSync(path.join(tmpDir, "note.md"), "# Hi");
    try {
      const encRes = await encPost(
        new Request("http://localhost/api/rag/encoding-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Enc5",
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
            name: "Store5",
            type: "local",
            bucket: "default",
          }),
        })
      );
      const store = await storeRes.json();
      const collRes = await collPost(
        new Request("http://localhost/api/rag/collections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Coll5",
            scope: "agent",
            encodingConfigId: enc.id,
            documentStoreId: store.id,
          }),
        })
      );
      const coll = await collRes.json();
      const connRes = await listPost(
        new Request("http://localhost/api/rag/connectors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "filesystem",
            collectionId: coll.id,
            config: { path: tmpDir },
          }),
        })
      );
      expect(connRes.status).toBe(201);
      const { id } = await connRes.json();
      const syncRes = await POST(
        new Request(`http://localhost/api/rag/connectors/${id}/sync`, { method: "POST" }),
        { params: Promise.resolve({ id }) }
      );
      expect(syncRes.status).toBe(200);
      const data = await syncRes.json();
      expect(data.ok).toBe(true);
      expect(data.synced).toBe(2);
      expect(data.total).toBe(2);
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true });
      } catch {
        // ignore
      }
    }
  });

  it("POST /api/rag/connectors/:id/sync respects includeIds for filesystem (only selected items synced)", async () => {
    const tmpDir = path.resolve(path.join(os.tmpdir(), `rag-sync-include-${Date.now()}`));
    fs.mkdirSync(tmpDir, { recursive: true });
    const f1 = path.join(tmpDir, "one.txt");
    const f2 = path.join(tmpDir, "two.md");
    const f3 = path.join(tmpDir, "three.txt");
    fs.writeFileSync(f1, "one");
    fs.writeFileSync(f2, "two");
    fs.writeFileSync(f3, "three");
    try {
      const encRes = await encPost(
        new Request("http://localhost/api/rag/encoding-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "EncInc",
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
            name: "StoreInc",
            type: "local",
            bucket: "default",
          }),
        })
      );
      const store = await storeRes.json();
      const collRes = await collPost(
        new Request("http://localhost/api/rag/collections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "CollInc",
            scope: "agent",
            encodingConfigId: enc.id,
            documentStoreId: store.id,
          }),
        })
      );
      const coll = await collRes.json();
      const connRes = await listPost(
        new Request("http://localhost/api/rag/connectors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "filesystem",
            collectionId: coll.id,
            config: { path: tmpDir, includeIds: [f1, f3] },
          }),
        })
      );
      expect(connRes.status).toBe(201);
      const { id } = await connRes.json();
      const syncRes = await POST(
        new Request(`http://localhost/api/rag/connectors/${id}/sync`, { method: "POST" }),
        { params: Promise.resolve({ id }) }
      );
      expect(syncRes.status).toBe(200);
      const data = await syncRes.json();
      expect(data.ok).toBe(true);
      expect(data.synced).toBe(2);
      expect(data.total).toBe(2);
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true });
      } catch {
        // ignore
      }
    }
  });

  it("POST /api/rag/connectors/:id/sync respects excludePatterns for filesystem (matching items skipped)", async () => {
    const tmpDir = path.resolve(path.join(os.tmpdir(), `rag-sync-exclude-${Date.now()}`));
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "keep.txt"), "keep");
    fs.writeFileSync(path.join(tmpDir, "skip.md"), "skip");
    fs.writeFileSync(path.join(tmpDir, "also-skip.md"), "also");
    try {
      const encRes = await encPost(
        new Request("http://localhost/api/rag/encoding-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "EncExcl",
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
            name: "StoreExcl",
            type: "local",
            bucket: "default",
          }),
        })
      );
      const store = await storeRes.json();
      const collRes = await collPost(
        new Request("http://localhost/api/rag/collections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "CollExcl",
            scope: "agent",
            encodingConfigId: enc.id,
            documentStoreId: store.id,
          }),
        })
      );
      const coll = await collRes.json();
      const connRes = await listPost(
        new Request("http://localhost/api/rag/connectors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "filesystem",
            collectionId: coll.id,
            config: { path: tmpDir, excludePatterns: ["*.md"] },
          }),
        })
      );
      expect(connRes.status).toBe(201);
      const { id } = await connRes.json();
      const syncRes = await POST(
        new Request(`http://localhost/api/rag/connectors/${id}/sync`, { method: "POST" }),
        { params: Promise.resolve({ id }) }
      );
      expect(syncRes.status).toBe(200);
      const data = await syncRes.json();
      expect(data.ok).toBe(true);
      expect(data.synced).toBe(1);
      expect(data.total).toBe(1);
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true });
      } catch {
        // ignore
      }
    }
  });
});
