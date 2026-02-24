import { json } from "../../../../_lib/response";
import { db } from "../../../../_lib/db";
import { ragEmbeddingProviders } from "@agentron-studio/core";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/** Known embedding dimensions for common models (Ollama and cloud). Used when Ollama /api/show is not available or model not found. */
const KNOWN_EMBED_DIMENSIONS: Record<string, number> = {
  "nomic-embed-text": 768,
  "all-minilm": 384,
  "mxbai-embed-large": 1024,
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,
};

function getDimensionsForModel(baseUrl: string, modelName: string): number | undefined {
  const base = modelName.split(":")[0];
  return KNOWN_EMBED_DIMENSIONS[base] ?? KNOWN_EMBED_DIMENSIONS[modelName];
}

export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db
    .select()
    .from(ragEmbeddingProviders)
    .where(eq(ragEmbeddingProviders.id, id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });
  const provider = rows[0];
  if (provider.type !== "local") {
    return json(
      { error: "Models list only supported for local (Ollama) providers" },
      { status: 400 }
    );
  }
  const baseUrl = (provider.endpoint || "http://localhost:11434").replace(/\/$/, "");
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return json({ error: "Ollama not responding" }, { status: 502 });
    const data = (await res.json()) as {
      models?: Array<{
        name: string;
        size: number;
        digest?: string;
        modified_at?: string;
        details?: { parameter_size?: string; quantization_level?: string; family?: string };
      }>;
    };
    const models = (data.models ?? []).map((m) => {
      const dimensions = getDimensionsForModel(baseUrl, m.name);
      return {
        name: m.name,
        size: m.size,
        digest: m.digest?.slice(0, 12),
        modifiedAt: m.modified_at,
        parameterSize: m.details?.parameter_size,
        quantization: m.details?.quantization_level,
        family: m.details?.family,
        ...(dimensions != null ? { dimensions } : {}),
      };
    });
    return json({ models });
  } catch {
    return json({ error: "Cannot connect to embedding provider" }, { status: 502 });
  }
}
