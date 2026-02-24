import { json } from "../../_lib/response";
import { getDeploymentCollectionId, retrieveChunks } from "../../_lib/rag";
import { getEffectiveRagRetrieveLimit, RAG_RETRIEVE_LIMIT_MAX } from "../../_lib/rag-limits";

export const runtime = "nodejs";

/**
 * Retrieve relevant chunks for a query from a RAG collection.
 * POST body: { collectionId?: string, query: string, limit?: number }
 * - If collectionId is omitted, uses the deployment (studio) collection.
 * - limit is clamped to system max; if omitted, effective limit for the scope is used.
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
  let collectionId = body.collectionId ?? (await getDeploymentCollectionId());
  if (!collectionId) {
    return json({ chunks: [] });
  }
  const effectiveLimit =
    typeof body.limit === "number" && body.limit >= 1
      ? Math.min(body.limit, RAG_RETRIEVE_LIMIT_MAX)
      : await getEffectiveRagRetrieveLimit(
          body.collectionId ? { type: "collection", collectionId } : { type: "chat" }
        );

  const chunks = await retrieveChunks(collectionId, query, effectiveLimit);
  return json({ chunks });
}
