import { json } from "../../_lib/response";
import { getDeploymentCollectionId, retrieveChunks } from "../../_lib/rag";

export const runtime = "nodejs";

/**
 * Retrieve relevant chunks for a query from a RAG collection.
 * POST body: { collectionId?: string, query: string, limit?: number }
 * - If collectionId is omitted, uses the deployment (studio) collection.
 * Returns { chunks: { text: string, score?: number, source?: string }[] }
 */
export async function POST(request: Request) {
  let body: { collectionId?: string; query: string; limit?: number };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const query = typeof body.query === "string" ? body.query : "";
  const limit = Math.min(Math.max(Number(body.limit) || 5, 1), 20);

  let collectionId = body.collectionId ?? (await getDeploymentCollectionId());
  if (!collectionId) {
    return json({ chunks: [] });
  }

  const chunks = await retrieveChunks(collectionId, query, limit);
  return json({ chunks });
}
