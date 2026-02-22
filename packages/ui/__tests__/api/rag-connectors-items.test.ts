import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { GET } from "../../app/api/rag/connectors/[id]/items/route";
import { POST as listPost } from "../../app/api/rag/connectors/route";
import { POST as collPost } from "../../app/api/rag/collections/route";
import { POST as encPost } from "../../app/api/rag/encoding-config/route";
import { POST as storePost } from "../../app/api/rag/document-store/route";

describe("GET /api/rag/connectors/:id/items (browse)", () => {
  it("returns 404 for non-existent connector", async () => {
    const res = await GET(
      new Request("http://localhost/api/rag/connectors/non-existent-id/items"),
      { params: Promise.resolve({ id: "non-existent-id" }) }
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Connector not found");
  });

  it("returns 400 for filesystem connector when config.path missing", async () => {
    const encRes = await encPost(
      new Request("http://localhost/api/rag/encoding-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "EncItems",
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
          name: "StoreItems",
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
          name: "CollItems",
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
    const getRes = await GET(new Request(`http://localhost/api/rag/connectors/${id}/items`), {
      params: Promise.resolve({ id }),
    });
    expect(getRes.status).toBe(400);
    const data = await getRes.json();
    expect(data.error).toContain("config.path");
  });

  it("returns 200 with items array for filesystem connector (no documents created)", async () => {
    const tmpDir = path.resolve(path.join(os.tmpdir(), `rag-browse-test-${Date.now()}`));
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "a.txt"), "a");
    fs.writeFileSync(path.join(tmpDir, "b.md"), "b");
    try {
      const encRes = await encPost(
        new Request("http://localhost/api/rag/encoding-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "EncBrowse",
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
            name: "StoreBrowse",
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
            name: "CollBrowse",
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
      const getRes = await GET(new Request(`http://localhost/api/rag/connectors/${id}/items`), {
        params: Promise.resolve({ id }),
      });
      expect(getRes.status).toBe(200);
      const data = await getRes.json();
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.items).toHaveLength(2);
      expect(data.items.every((i: { id: string; name: string }) => i.id && i.name)).toBe(true);
      const names = data.items.map((i: { name: string }) => i.name).sort();
      expect(names).toEqual(["a.txt", "b.md"]);
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true });
      } catch {
        // ignore
      }
    }
  });
});
