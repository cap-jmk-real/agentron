import type { LLMProvider } from "@agentron-studio/core";

export interface RateLimitConfig {
  /** Max requests per minute (sliding window). */
  requestsPerMinute: number;
  /** Max tokens per minute (input + output, sliding window). Omit for no TPM cap. */
  tokensPerMinute?: number;
}

/**
 * Default rate limits per provider to avoid hitting API caps.
 * Based on typical tier limits; users can override in LLM config.
 * - OpenAI: tier-dependent (e.g. 60 RPM, 90k TPM for paid).
 * - Anthropic: Free 5 RPM/20k TPM, Build 50/100k, Scale 1000/400k — use conservative Build.
 * - OpenRouter: varies by route, often 60+ RPM.
 * - Hugging Face: free tier low; use 20 RPM.
 * - Local (Ollama): no API limit; cap to avoid overwhelming GPU (e.g. 120 RPM).
 * - Azure/GCP: similar to OpenAI.
 */
export const DEFAULT_RATE_LIMITS: Record<LLMProvider, RateLimitConfig> = {
  openai: { requestsPerMinute: 60, tokensPerMinute: 90_000 },
  anthropic: { requestsPerMinute: 50, tokensPerMinute: 100_000 },
  azure: { requestsPerMinute: 60, tokensPerMinute: 90_000 },
  gcp: { requestsPerMinute: 60, tokensPerMinute: 90_000 },
  openrouter: { requestsPerMinute: 60, tokensPerMinute: 100_000 },
  huggingface: { requestsPerMinute: 20, tokensPerMinute: 30_000 },
  local: { requestsPerMinute: 120 }, // no TPM cap for Ollama
  custom_http: { requestsPerMinute: 60, tokensPerMinute: 90_000 },
};

export interface LLMConfigWithId {
  id?: string;
  provider: LLMProvider;
  model: string;
  apiKeyRef?: string;
  endpoint?: string;
  extra?: { rateLimit?: RateLimitConfig } & Record<string, unknown>;
}

export function getRateLimitForConfig(config: LLMConfigWithId): RateLimitConfig {
  const custom = config.extra?.rateLimit;
  const defaults = DEFAULT_RATE_LIMITS[config.provider];
  return {
    requestsPerMinute: custom?.requestsPerMinute ?? defaults.requestsPerMinute,
    tokensPerMinute: custom?.tokensPerMinute ?? defaults.tokensPerMinute,
  };
}
