/**
 * Query external vector stores (Qdrant, pgvector). Bundled store is queried in rag.ts directly.
 */

export type VectorStoreConfig = {
  endpoint?: string;
  apiKeyRef?: string;
  connectionStringRef?: string;
  tableName?: string;
};

export type RagChunk = { text: string; score?: number; source?: string };

function getApiKey(apiKeyRef?: string): string | undefined {
  if (!apiKeyRef || typeof process === "undefined") return undefined;
  return process.env[apiKeyRef];
}

/**
 * Query Qdrant for similar vectors. Config: endpoint (e.g. https://xxx.qdrant.io or http://localhost:6333), apiKeyRef (optional).
 * Collection name in Qdrant is the RAG collectionId.
 */
export async function queryQdrant(
  collectionId: string,
  queryVector: number[],
  limit: number,
  config: VectorStoreConfig
): Promise<RagChunk[]> {
  const endpoint = (config.endpoint || "http://localhost:6333").replace(/\/$/, "");
  const url = `${endpoint}/collections/${encodeURIComponent(collectionId)}/points/search`;
  const apiKey = getApiKey(config.apiKeyRef);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "api-key": apiKey } : {}),
    },
    body: JSON.stringify({
      vector: queryVector,
      limit,
      with_payload: true,
      with_vector: false,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Qdrant search failed: ${res.status} ${err}`);
  }
  const data = (await res.json()) as {
    result?: Array<{ id?: unknown; score?: number; payload?: { text?: string } }>;
  };
  const result = data.result || [];
  return result
    .map((r) => ({
      text: r.payload?.text ?? "",
      score: r.score,
    }))
    .filter((c) => c.text);
}

/**
 * Query pgvector. Config: connectionStringRef (env var with Postgres connection string), tableName (default rag_vectors).
 * Table must have: collection_id, embedding (vector), text.
 */
export async function queryPgvector(
  collectionId: string,
  queryVector: number[],
  limit: number,
  config: VectorStoreConfig
): Promise<RagChunk[]> {
  const ref = config.connectionStringRef;
  if (!ref || typeof process === "undefined" || !process.env[ref]) {
    throw new Error("pgvector connectionStringRef env var not set");
  }
  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env[ref] });
  await client.connect();
  try {
    const table = config.tableName || "rag_vectors";
    const vectorStr = `[${queryVector.join(",")}]`;
    const res = await client.query(
      `SELECT text, 1 - (embedding <=> $1::vector) AS score FROM ${table} WHERE collection_id = $2 ORDER BY embedding <=> $1::vector LIMIT $3`,
      [vectorStr, collectionId, limit]
    );
    return res.rows.map((r: { text: string; score: number }) => ({ text: r.text, score: r.score }));
  } finally {
    await client.end();
  }
}
