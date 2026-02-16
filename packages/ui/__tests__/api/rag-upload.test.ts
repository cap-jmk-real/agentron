import { describe, it, expect, beforeAll, vi } from "vitest";
import { POST as uploadPost } from "../../app/api/rag/upload/route";

vi.mock("../../app/api/_lib/s3", () => ({
  putObject: vi.fn().mockResolvedValue(undefined),
}));
import { POST as encPost } from "../../app/api/rag/encoding-config/route";
import { POST as storePost } from "../../app/api/rag/document-store/route";
import { POST as collPost } from "../../app/api/rag/collections/route";

describe("RAG upload API", () => {
  let collectionId: string;

  beforeAll(async () => {
    const encRes = await encPost(
      new Request("http://localhost/api/rag/encoding-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Upload enc",
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
          name: "Upload store",
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
          name: "Upload coll",
          scope: "agent",
          encodingConfigId: enc.id,
          documentStoreId: store.id,
        }),
      })
    );
    const coll = await collRes.json();
    collectionId = coll.id;
  });

  it("POST /api/rag/upload returns 400 when no file provided", async () => {
    const form = new FormData();
    const res = await uploadPost(
      new Request("http://localhost/api/rag/upload", { method: "POST", body: form })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("No file");
  });

  it("POST /api/rag/upload returns 404 when collection not found", async () => {
    const form = new FormData();
    form.append("file", new Blob(["content"]), "test.txt");
    form.append("collectionId", "non-existent-collection-id");
    const res = await uploadPost(
      new Request("http://localhost/api/rag/upload", { method: "POST", body: form })
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain("Collection not found");
  });

  it("POST /api/rag/upload returns 201 and document metadata when file and valid collectionId", async () => {
    const form = new FormData();
    form.append("file", new Blob(["upload test content"]), "upload-test.txt");
    form.append("collectionId", collectionId);
    const res = await uploadPost(
      new Request("http://localhost/api/rag/upload", { method: "POST", body: form })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.collectionId).toBe(collectionId);
    expect(data.storePath).toMatch(/^uploads\//);
    expect(data.originalName).toBe("upload-test.txt");
  });
});
