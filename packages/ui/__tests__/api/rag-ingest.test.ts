import { describe, it, expect, vi, beforeAll } from "vitest";
import { POST as ingestPost } from "../../app/api/rag/ingest/route";
import { POST as encPost } from "../../app/api/rag/encoding-config/route";
import { POST as storePost } from "../../app/api/rag/document-store/route";
import { POST as collPost } from "../../app/api/rag/collections/route";
import { db } from "../../app/api/_lib/db";
import { ragDocuments, ragCollections } from "@agentron-studio/core";
import { eq } from "drizzle-orm";
import path from "node:path";
import fs from "node:fs";

vi.mock("../../app/api/_lib/embeddings", () => ({
  embed: vi.fn().mockImplementation((_: string, texts: string[]) =>
    Promise.resolve(texts.map(() => [0.1, 0.1, 0.1]))
  ),
}));

vi.mock("../../app/api/_lib/s3", () => ({
  getObject: vi.fn().mockResolvedValue(Buffer.from("Sample document text for ingestion.", "utf-8")),
}));

describe("RAG ingest API", () => {
  let collectionId: string;
  let documentId: string;

  beforeAll(async () => {
    const encRes = await encPost(
      new Request("http://localhost/api/rag/encoding-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Ingest enc",
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
          name: "Ingest store",
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
          name: "Ingest coll",
          scope: "agent",
          encodingConfigId: enc.id,
          documentStoreId: store.id,
        }),
      })
    );
    const coll = await collRes.json();
    collectionId = coll.id;
    documentId = crypto.randomUUID();
    await db
      .insert(ragDocuments)
      .values({
        id: documentId,
        collectionId,
        externalId: null,
        storePath: "uploads/ingest-doc.txt",
        mimeType: "text/plain",
        metadata: "{}",
        createdAt: Date.now(),
      })
      .run();
  });

  it("POST /api/rag/ingest returns 400 for invalid JSON", async () => {
    const res = await ingestPost(
      new Request("http://localhost/api/rag/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("POST /api/rag/ingest returns 400 when documentId missing", async () => {
    const res = await ingestPost(
      new Request("http://localhost/api/rag/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("documentId");
  });

  it("POST /api/rag/ingest returns 404 for unknown documentId", async () => {
    const res = await ingestPost(
      new Request("http://localhost/api/rag/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: "non-existent-doc-id" }),
      })
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain("Document not found");
  });

  it("POST /api/rag/ingest succeeds with mocked embed and getObject", async () => {
    const res = await ingestPost(
      new Request("http://localhost/api/rag/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.chunks).toBeGreaterThan(0);
  });
});
