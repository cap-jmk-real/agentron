import { db } from "./db";
import { ragCollections, ragVectors, ragVectorStores } from "@agentron-studio/core";
import { eq } from "drizzle-orm";
import { embed } from "./embeddings";
import { queryQdrant, queryPgvector } from "./vector-store-query";

export type RagChunk = { text: string; score?: number; source?: string };

/**
 * Returns the deployment (studio) RAG collection id, or null if none.
 */
export async function getDeploymentCollectionId(): Promise<string | null> {
  const rows = await db
    .select({ id: ragCollections.id })
    .from(ragCollections)
    .where(eq(ragCollections.scope, "deployment"))
    .limit(1);
  return rows[0]?.id ?? null;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Retrieve relevant chunks for a query. Uses collection's encoding config to embed the query,
 * then searches the vector store: bundled (rag_vectors), Qdrant, or pgvector.
 */
export async function retrieveChunks(
  collectionId: string,
  query: string,
  limit: number
): Promise<RagChunk[]> {
  const collRows = await db.select().from(ragCollections).where(eq(ragCollections.id, collectionId));
  if (collRows.length === 0) return [];
  const collection = collRows[0];
  const encodingConfigId = collection.encodingConfigId;

  const [queryVector] = await embed(encodingConfigId, [query]);
  if (!queryVector) return [];

  const vectorStoreId = collection.vectorStoreId;
  if (vectorStoreId) {
    const storeRows = await db.select().from(ragVectorStores).where(eq(ragVectorStores.id, vectorStoreId));
    const store = storeRows[0];
    if (store && store.type === "qdrant") {
      const config = store.config ? (JSON.parse(store.config) as { endpoint?: string; apiKeyRef?: string }) : {};
      try {
        return await queryQdrant(collectionId, queryVector, limit, config);
      } catch {
        return [];
      }
    }
    if (store && store.type === "pgvector") {
      const config = store.config ? (JSON.parse(store.config) as { connectionStringRef?: string; tableName?: string }) : {};
      try {
        return await queryPgvector(collectionId, queryVector, limit, config);
      } catch {
        return [];
      }
    }
  }

  // Bundled: search rag_vectors table
  const rows = await db.select().from(ragVectors).where(eq(ragVectors.collectionId, collectionId));
  const withScore: { text: string; score: number }[] = [];
  for (const r of rows) {
    let vec: number[];
    try {
      vec = JSON.parse(r.embedding) as number[];
    } catch {
      continue;
    }
    const score = cosineSimilarity(queryVector, vec);
    withScore.push({ text: r.text, score });
  }
  withScore.sort((a, b) => b.score - a.score);
  return withScore.slice(0, limit).map(({ text, score }) => ({ text, score }));
}
