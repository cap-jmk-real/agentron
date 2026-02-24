import { db } from "./db";
import { ragEncodingConfigs, ragEmbeddingProviders, llmConfigs } from "@agentron-studio/core";
import { eq } from "drizzle-orm";
import { fromLlmConfigRowWithSecret } from "./db";

export type EncodingConfigRow = {
  id: string;
  name: string;
  provider: string;
  modelOrEndpoint: string;
  dimensions: number;
  embeddingProviderId?: string | null;
  endpoint?: string | null;
  createdAt: number;
};

/**
 * Get encoding config by id.
 */
export async function getEncodingConfig(
  encodingConfigId: string
): Promise<EncodingConfigRow | null> {
  const rows = await db
    .select()
    .from(ragEncodingConfigs)
    .where(eq(ragEncodingConfigs.id, encodingConfigId));
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    provider: r.provider,
    modelOrEndpoint: r.modelOrEndpoint,
    dimensions: r.dimensions,
    embeddingProviderId: r.embeddingProviderId ?? undefined,
    endpoint: r.endpoint ?? undefined,
    createdAt: r.createdAt,
  };
}

/**
 * Resolve API key for an embedding provider (e.g. openai). Uses first LLM config matching the provider.
 */
async function getApiKeyForProvider(provider: string): Promise<string | undefined> {
  const rows = await db.select().from(llmConfigs);
  const match = rows.find((r) => r.provider === provider);
  if (!match) return undefined;
  const config = fromLlmConfigRowWithSecret(match);
  const ref = config.apiKeyRef;
  if (ref && typeof process !== "undefined" && process.env?.[ref]) return process.env[ref];
  return typeof config.extra?.apiKey === "string" ? config.extra.apiKey : undefined;
}

function getApiKeyFromEmbeddingProviderRow(row: {
  apiKeyRef?: string | null;
  extra?: string | null;
}): string | undefined {
  if (row.apiKeyRef && typeof process !== "undefined" && process.env?.[row.apiKeyRef]) {
    return process.env[row.apiKeyRef];
  }
  if (row.extra) {
    try {
      const extra = JSON.parse(row.extra) as Record<string, unknown>;
      if (typeof (extra as { apiKey?: string }).apiKey === "string") {
        return (extra as { apiKey: string }).apiKey;
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}

/**
 * Embed via Settings embedding provider (local Ollama or API).
 */
async function embedViaProvider(
  provider: {
    type: string;
    endpoint?: string | null;
    apiKeyRef?: string | null;
    extra?: string | null;
  },
  model: string,
  texts: string[]
): Promise<number[][]> {
  if (provider.type === "local") {
    const baseUrl = (provider.endpoint || "http://localhost:11434").replace(/\/$/, "");
    if (!baseUrl) {
      throw new Error(
        "No endpoint for local embedding provider. Set endpoint in Settings → Embedding."
      );
    }
    const url = `${baseUrl}/api/embed`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        input: texts.length === 1 ? texts[0] : texts,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Ollama embedding error (${res.status}): ${err}`);
    }
    const data = (await res.json()) as { embeddings?: number[][] };
    const embeddings = Array.isArray(data.embeddings) ? data.embeddings : [];
    if (embeddings.length !== texts.length) {
      throw new Error(
        `Embedding API returned ${embeddings.length} vectors for ${texts.length} inputs`
      );
    }
    return embeddings;
  }

  // OpenAI-compatible (openai, openrouter, custom_http, huggingface)
  const apiKey = getApiKeyFromEmbeddingProviderRow(provider);
  const endpoint =
    provider.type === "openai"
      ? (provider.endpoint || "https://api.openai.com/v1").replace(/\/$/, "")
      : provider.type === "openrouter"
        ? (provider.endpoint || "https://openrouter.ai/api/v1").replace(/\/$/, "")
        : provider.type === "huggingface"
          ? (provider.endpoint || "https://api-inference.huggingface.co").replace(/\/$/, "")
          : provider.endpoint
            ? provider.endpoint.replace(/\/embeddings.*$/i, "").replace(/\/$/, "")
            : "";
  if (!endpoint) {
    throw new Error(`No endpoint for embedding provider. Set endpoint in Settings → Embedding.`);
  }
  if (provider.type !== "local" && !apiKey) {
    throw new Error(
      `No API key configured for embedding provider. Set API key in Settings → Embedding.`
    );
  }
  const url = `${endpoint}/embeddings`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      input: texts.length === 1 ? texts[0] : texts,
      model: model || "text-embedding-3-small",
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Embedding API error (${res.status}): ${err}`);
  }
  const data = (await res.json()) as { data?: Array<{ embedding: number[] }> };
  const embeddings = Array.isArray(data.data) ? data.data.map((d) => d.embedding) : [];
  if (embeddings.length !== texts.length) {
    throw new Error(
      `Embedding API returned ${embeddings.length} vectors for ${texts.length} inputs`
    );
  }
  return embeddings;
}

/**
 * Embed one or more texts using the given encoding config. Returns array of vectors (array of numbers).
 */
export async function embed(encodingConfigId: string, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const config = await getEncodingConfig(encodingConfigId);
  if (!config) throw new Error(`Encoding config not found: ${encodingConfigId}`);

  if (config.embeddingProviderId) {
    const provRows = await db
      .select()
      .from(ragEmbeddingProviders)
      .where(eq(ragEmbeddingProviders.id, config.embeddingProviderId));
    if (provRows.length === 0) {
      throw new Error(`Embedding provider not found: ${config.embeddingProviderId}`);
    }
    const provider = provRows[0];
    return embedViaProvider(provider, config.modelOrEndpoint, texts);
  }

  // Legacy path: use provider string and LLM config for API key
  const apiKey = await getApiKeyForProvider(config.provider);
  if (!apiKey)
    throw new Error(
      `No API key configured for embedding provider "${config.provider}". Add an LLM provider with the same name in Settings → LLM Providers.`
    );

  const endpoint =
    config.provider === "openai"
      ? "https://api.openai.com/v1"
      : config.provider === "openrouter"
        ? "https://openrouter.ai/api/v1"
        : config.endpoint
          ? config.endpoint.replace(/\/embeddings.*$/i, "").replace(/\/$/, "")
          : config.modelOrEndpoint.includes("http")
            ? config.modelOrEndpoint.replace(/\/embeddings.*$/i, "").replace(/\/$/, "")
            : "https://api.openai.com/v1";

  const model = config.modelOrEndpoint.includes("http") ? "default" : config.modelOrEndpoint;
  const url = `${endpoint}/embeddings`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: texts.length === 1 ? texts[0] : texts,
      model,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Embedding API error (${res.status}): ${err}`);
  }
  const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
  const embeddings = Array.isArray(data.data) ? data.data.map((d) => d.embedding) : [];
  if (embeddings.length !== texts.length) {
    throw new Error(
      `Embedding API returned ${embeddings.length} vectors for ${texts.length} inputs`
    );
  }
  return embeddings;
}
