import { describe, it, expect, beforeAll, vi } from "vitest";
import { POST as uploadPost } from "../../app/api/rag/upload/route";

vi.mock("../../app/api/_lib/s3", () => ({
  putObject: vi.fn().mockResolvedValue(undefined),
}));
import * as appSettings from "../../app/api/_lib/app-settings";
import * as rag from "../../app/api/_lib/rag";
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

  it("POST /api/rag/upload returns 413 when file exceeds max size", async () => {
    vi.spyOn(appSettings, "getMaxFileUploadBytes").mockReturnValue(5);
    vi.spyOn(appSettings, "formatMaxFileUploadMb").mockReturnValue("5 MB");
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(20)]), "large.bin");
    form.append("collectionId", collectionId);
    const res = await uploadPost(
      new Request("http://localhost/api/rag/upload", { method: "POST", body: form })
    );
    expect(res.status).toBe(413);
    const data = await res.json();
    expect(data.error).toContain("too large");
    vi.restoreAllMocks();
  });

  it("POST /api/rag/upload returns 400 when no collectionId and no deployment collection", async () => {
    vi.spyOn(rag, "getDeploymentCollectionId").mockResolvedValue(null);
    const form = new FormData();
    form.append("file", new Blob(["x"]), "a.txt");
    const res = await uploadPost(
      new Request("http://localhost/api/rag/upload", { method: "POST", body: form })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/collection|deployment/);
    vi.restoreAllMocks();
  });

  it("POST /api/rag/upload returns 502 when S3 putObject fails", async () => {
    const s3 = await import("../../app/api/_lib/s3");
    vi.mocked(s3.putObject).mockRejectedValueOnce(new Error("Bucket access denied"));
    const form = new FormData();
    form.append("file", new Blob(["x"]), "a.txt");
    form.append("collectionId", collectionId);
    const res = await uploadPost(
      new Request("http://localhost/api/rag/upload", { method: "POST", body: form })
    );
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toContain("Bucket upload failed");
    expect(data.error).toContain("Bucket access denied");
    vi.mocked(s3.putObject).mockResolvedValue(undefined);
  });

  it("POST /api/rag/upload writes to local dir when document store is not S3/MinIO", async () => {
    const encRes = await encPost(
      new Request("http://localhost/api/rag/encoding-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Local enc",
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
          name: "Local store",
          type: "local",
          bucket: "",
        }),
      })
    );
    const store = await storeRes.json();
    const collRes = await collPost(
      new Request("http://localhost/api/rag/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Local coll",
          scope: "agent",
          encodingConfigId: enc.id,
          documentStoreId: store.id,
        }),
      })
    );
    const coll = await collRes.json();
    const localCollId = coll.id;
    const form = new FormData();
    form.append("file", new Blob(["local upload content"]), "local-file.txt");
    form.append("collectionId", localCollId);
    const res = await uploadPost(
      new Request("http://localhost/api/rag/upload", { method: "POST", body: form })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.collectionId).toBe(localCollId);
    expect(data.originalName).toBe("local-file.txt");
    expect(data.storePath).toMatch(/^uploads\//);
  });
});
