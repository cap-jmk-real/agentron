import { describe, it, expect, vi, beforeAll } from "vitest";
import { getDeploymentCollectionId, retrieveChunks } from "../../../app/api/_lib/rag";
import { db } from "../../../app/api/_lib/db";
import { ragCollections, ragVectors, ragVectorStores } from "@agentron-studio/core";
import { eq } from "drizzle-orm";
import { GET as encListGet, POST as encPost } from "../../../app/api/rag/encoding-config/route";
import { GET as storeListGet, POST as storePost } from "../../../app/api/rag/document-store/route";
import { POST as collPost } from "../../../app/api/rag/collections/route";
import { POST as vectorStorePost } from "../../../app/api/rag/vector-store/route";
import { embed } from "../../../app/api/_lib/embeddings";
import * as vectorStoreQuery from "../../../app/api/_lib/vector-store-query";

vi.mock("../../../app/api/_lib/embeddings", () => ({
  embed: vi.fn().mockResolvedValue([[0.1, 0.1, 0.1]]),
}));

describe("rag", () => {
  describe("getDeploymentCollectionId", () => {
    it("returns null when no deployment-scope collection exists", async () => {
      const existing = await db
        .select({ id: ragCollections.id })
        .from(ragCollections)
        .where(eq(ragCollections.scope, "deployment"))
        .limit(1);
      if (existing.length > 0) {
        await db.delete(ragCollections).where(eq(ragCollections.id, existing[0].id)).run();
      }
      const id = await getDeploymentCollectionId();
      expect(id).toBeNull();
    });

    it("returns deployment collection id when one exists", async () => {
      let encId: string;
      const encRes = await encListGet();
      const encList = await encRes.json();
      if (Array.isArray(encList) && encList.length > 0) {
        encId = encList[0].id;
      } else {
        const r = await encPost(
          new Request("http://localhost/api/rag/encoding-config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: "RAG test enc",
              provider: "openai",
              modelOrEndpoint: "text-embedding-3-small",
              dimensions: 1536,
            }),
          })
        );
        const d = await r.json();
        encId = d.id;
      }
      let storeId: string;
      const storeRes = await storeListGet();
      const storeList = await storeRes.json();
      if (Array.isArray(storeList) && storeList.length > 0) {
        storeId = storeList[0].id;
      } else {
        const r = await storePost(
          new Request("http://localhost/api/rag/document-store", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: "RAG test store",
              type: "minio",
              bucket: "b",
              endpoint: "http://localhost:9000",
            }),
          })
        );
        const d = await r.json();
        storeId = d.id;
      }
      const collRes = await collPost(
        new Request("http://localhost/api/rag/collections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Deployment collection",
            scope: "deployment",
            encodingConfigId: encId,
            documentStoreId: storeId,
          }),
        })
      );
      expect(collRes.status).toBe(201);
      const coll = await collRes.json();
      const deploymentId = await getDeploymentCollectionId();
      expect(deploymentId).toBe(coll.id);
    });
  });

  describe("retrieveChunks", () => {
    let collectionId: string;

    beforeAll(async () => {
      const encRes = await encPost(
        new Request("http://localhost/api/rag/encoding-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "RAG retrieve test enc",
            provider: "openai",
            modelOrEndpoint: "text-embedding-3-small",
            dimensions: 3,
          }),
        })
      );
      const encData = await encRes.json();
      const storeRes = await storePost(
        new Request("http://localhost/api/rag/document-store", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "RAG retrieve store",
            type: "minio",
            bucket: "b",
            endpoint: "http://localhost:9000",
          }),
        })
      );
      const storeData = await storeRes.json();
      const collRes = await collPost(
        new Request("http://localhost/api/rag/collections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Retrieve test collection",
            scope: "agent",
            encodingConfigId: encData.id,
            documentStoreId: storeData.id,
          }),
        })
      );
      const collData = await collRes.json();
      collectionId = collData.id;
      const now = Date.now();
      await db
        .insert(ragVectors)
        .values([
          {
            id: crypto.randomUUID(),
            collectionId,
            documentId: "doc1",
            chunkIndex: 0,
            text: "first chunk",
            embedding: JSON.stringify([0.1, 0.1, 0.1]),
            createdAt: now,
          },
          {
            id: crypto.randomUUID(),
            collectionId,
            documentId: "doc1",
            chunkIndex: 1,
            text: "second chunk",
            // Different direction so cosine similarity with query [0.1,0.1,0.1] is lower than "first chunk".
            embedding: JSON.stringify([0.5, 0, 0]),
            createdAt: now,
          },
        ])
        .run();
    });

    it("returns empty array for unknown collection", async () => {
      const chunks = await retrieveChunks("non-existent-collection-id", "query", 5);
      expect(chunks).toEqual([]);
    });

    it("returns chunks from bundled store sorted by cosine similarity", async () => {
      const chunks = await retrieveChunks(collectionId, "query", 5);
      expect(chunks.length).toBe(2);
      expect(chunks[0].text).toBe("first chunk");
      expect(chunks[1].text).toBe("second chunk");
      expect(chunks[0].score).toBeGreaterThanOrEqual(chunks[1].score ?? 0);
    });

    it("respects limit", async () => {
      const chunks = await retrieveChunks(collectionId, "query", 1);
      expect(chunks.length).toBe(1);
    });

    it("returns empty array when embed returns no vector", async () => {
      vi.mocked(embed).mockResolvedValueOnce([]);
      const chunks = await retrieveChunks(collectionId, "query", 5);
      expect(chunks).toEqual([]);
    });

    it("skips vectors with invalid JSON embedding", async () => {
      await db
        .insert(ragVectors)
        .values({
          id: crypto.randomUUID(),
          collectionId,
          documentId: "doc-invalid",
          chunkIndex: 0,
          text: "invalid embedding row",
          embedding: "not-valid-json",
          createdAt: Date.now(),
        })
        .run();
      const chunks = await retrieveChunks(collectionId, "query", 10);
      expect(chunks.every((c) => c.text !== "invalid embedding row")).toBe(true);
      expect(chunks.length).toBeGreaterThanOrEqual(2);
    });

    it("returns empty array when collection has Qdrant store and queryQdrant throws", async () => {
      const vsRes = await vectorStorePost(
        new Request("http://localhost/api/rag/vector-store", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Qdrant test",
            type: "qdrant",
            config: { endpoint: "http://localhost:6333" },
          }),
        })
      );
      const vsData = await vsRes.json();
      const encRes = await encPost(
        new Request("http://localhost/api/rag/encoding-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Enc qdrant",
            provider: "openai",
            modelOrEndpoint: "text-embedding-3-small",
            dimensions: 3,
          }),
        })
      );
      const encData = await encRes.json();
      const storeRes = await storePost(
        new Request("http://localhost/api/rag/document-store", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Store qdrant",
            type: "minio",
            bucket: "b",
            endpoint: "http://localhost:9000",
          }),
        })
      );
      const storeData = await storeRes.json();
      const collRes = await collPost(
        new Request("http://localhost/api/rag/collections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Coll qdrant",
            scope: "agent",
            encodingConfigId: encData.id,
            documentStoreId: storeData.id,
            vectorStoreId: vsData.id,
          }),
        })
      );
      const collData = await collRes.json();
      vi.spyOn(vectorStoreQuery, "queryQdrant").mockRejectedValueOnce(new Error("Qdrant down"));
      const chunks = await retrieveChunks(collData.id, "query", 5);
      expect(chunks).toEqual([]);
      vi.restoreAllMocks();
    });

    it("returns empty array when collection has pgvector store and queryPgvector throws", async () => {
      const vsRes = await vectorStorePost(
        new Request("http://localhost/api/rag/vector-store", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Pgvector test",
            type: "pgvector",
            config: { connectionStringRef: "PG_TEST_REF" },
          }),
        })
      );
      const vsData = await vsRes.json();
      const encRes = await encPost(
        new Request("http://localhost/api/rag/encoding-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Enc pgvector",
            provider: "openai",
            modelOrEndpoint: "text-embedding-3-small",
            dimensions: 3,
          }),
        })
      );
      const encData = await encRes.json();
      const storeRes = await storePost(
        new Request("http://localhost/api/rag/document-store", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Store pgvector",
            type: "minio",
            bucket: "b",
            endpoint: "http://localhost:9000",
          }),
        })
      );
      const storeData = await storeRes.json();
      const collRes = await collPost(
        new Request("http://localhost/api/rag/collections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Coll pgvector",
            scope: "agent",
            encodingConfigId: encData.id,
            documentStoreId: storeData.id,
            vectorStoreId: vsData.id,
          }),
        })
      );
      const collData = await collRes.json();
      vi.spyOn(vectorStoreQuery, "queryPgvector").mockRejectedValueOnce(
        new Error("pg connection failed")
      );
      const chunks = await retrieveChunks(collData.id, "query", 5);
      expect(chunks).toEqual([]);
      vi.restoreAllMocks();
    });
  });
});
