import { db } from "./db";
import { ragEncodingConfigs, llmConfigs } from "@agentron-studio/core";
import { eq } from "drizzle-orm";
import { fromLlmConfigRowWithSecret } from "./db";

export type EncodingConfigRow = {
  id: string;
  name: string;
  provider: string;
  modelOrEndpoint: string;
  dimensions: number;
  createdAt: number;
};

/**
 * Get encoding config by id.
 */
export async function getEncodingConfig(encodingConfigId: string): Promise<EncodingConfigRow | null> {
  const rows = await db.select().from(ragEncodingConfigs).where(eq(ragEncodingConfigs.id, encodingConfigId));
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    provider: r.provider,
    modelOrEndpoint: r.modelOrEndpoint,
    dimensions: r.dimensions,
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

/**
 * Embed one or more texts using the given encoding config. Returns array of vectors (array of numbers).
 */
export async function embed(
  encodingConfigId: string,
  texts: string[]
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const config = await getEncodingConfig(encodingConfigId);
  if (!config) throw new Error(`Encoding config not found: ${encodingConfigId}`);
  const apiKey = await getApiKeyForProvider(config.provider);
  if (!apiKey) throw new Error(`No API key configured for embedding provider "${config.provider}". Add an LLM provider with the same name in Settings → LLM Providers.`);

  // OpenAI-compatible embeddings endpoint (works for OpenAI, OpenRouter, and many others)
  const endpoint =
    config.provider === "openai"
      ? "https://api.openai.com/v1"
      : config.provider === "openrouter"
        ? "https://openrouter.ai/api/v1"
        : config.modelOrEndpoint.includes("http")
          ? config.modelOrEndpoint.replace(/\/embeddings.*$/i, "").replace(/\/$/, "")
          : "https://api.openai.com/v1";

  const model = config.modelOrEndpoint.includes("http") ? "text-embedding-3-small" : config.modelOrEndpoint;
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
    throw new Error(`Embedding API returned ${embeddings.length} vectors for ${texts.length} inputs`);
  }
  return embeddings;
}
