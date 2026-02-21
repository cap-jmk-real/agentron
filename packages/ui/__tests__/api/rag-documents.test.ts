import { describe, it, expect } from "vitest";
import { GET } from "../../app/api/rag/documents/route";
import { db } from "../../app/api/_lib/db";
import { ragDocuments } from "@agentron-studio/core";
import { eq } from "drizzle-orm";

describe("RAG documents API", () => {
  it("GET /api/rag/documents returns 400 when collectionId missing", async () => {
    const res = await GET(new Request("http://localhost/api/rag/documents"));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("collectionId");
  });

  it("GET /api/rag/documents?collectionId=some-id returns array", async () => {
    const res = await GET(
      new Request("http://localhost/api/rag/documents?collectionId=some-collection-id")
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("GET /api/rag/documents returns documents with metadata parsed when present", async () => {
    const collId = "docs-meta-coll-" + Date.now();
    const docId = crypto.randomUUID();
    await db
      .insert(ragDocuments)
      .values({
        id: docId,
        collectionId: collId,
        storePath: "path/doc.txt",
        mimeType: "text/plain",
        metadata: JSON.stringify({ source: "test" }),
        createdAt: Date.now(),
      })
      .run();
    try {
      const res = await GET(
        new Request(`http://localhost/api/rag/documents?collectionId=${collId}`)
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      const doc = data.find((d: { id: string }) => d.id === docId);
      expect(doc).toBeDefined();
      expect(doc.metadata).toEqual({ source: "test" });
    } finally {
      await db.delete(ragDocuments).where(eq(ragDocuments.id, docId)).run();
    }
  });

  it("GET /api/rag/documents returns documents with undefined metadata and mimeType when null", async () => {
    const collId = "docs-null-meta-" + Date.now();
    const docId = crypto.randomUUID();
    await db
      .insert(ragDocuments)
      .values({
        id: docId,
        collectionId: collId,
        storePath: "path/plain.txt",
        mimeType: "text/plain",
        metadata: null,
        createdAt: Date.now(),
      })
      .run();
    try {
      const res = await GET(
        new Request(`http://localhost/api/rag/documents?collectionId=${collId}`)
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      const doc = data.find((d: { id: string }) => d.id === docId);
      expect(doc).toBeDefined();
      expect(doc.metadata).toBeUndefined();
      expect(doc.mimeType).toBe("text/plain");
    } finally {
      await db.delete(ragDocuments).where(eq(ragDocuments.id, docId)).run();
    }
  });
});
