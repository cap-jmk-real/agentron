import type { LLMConfig } from "@agentron-studio/core";
import type { LLMProvider } from "@agentron-studio/core";
import type { LLMProviderAdapter, LLMRequest, LLMRequestContext, LLMResponse } from "./types";
import { anthropicProvider } from "./providers/anthropic";
import { azureProvider } from "./providers/azure";
import { customHttpProvider } from "./providers/custom-http";
import { gcpProvider } from "./providers/gcp";
import { localProvider } from "./providers/local";
import { openaiProvider } from "./providers/openai";
import { openrouterProvider } from "./providers/openrouter";
import { huggingfaceProvider } from "./providers/huggingface";
import { getRateLimitForConfig, type LLMConfigWithId } from "./rate-limits";
import { getDefaultRateLimiter } from "./rate-limiter";

export type SecretResolver = (ref?: string) => Promise<string | undefined>;

export class LLMManager {
  private providers = new Map<LLMProvider, LLMProviderAdapter>();
  private resolveSecret?: SecretResolver;

  constructor(resolveSecret?: SecretResolver) {
    this.resolveSecret = resolveSecret;
  }

  register(provider: LLMProviderAdapter) {
    this.providers.set(provider.provider, provider);
  }

  registerDefaults() {
    this.register(localProvider);
    this.register(openaiProvider);
    this.register(anthropicProvider);
    this.register(azureProvider);
    this.register(gcpProvider);
    this.register(openrouterProvider);
    this.register(huggingfaceProvider);
    this.register(customHttpProvider);
  }

  async chat(config: LLMConfig & { id?: string }, request: LLMRequest, context?: LLMRequestContext): Promise<LLMResponse> {
    const provider = this.providers.get(config.provider);
    if (!provider) {
      throw new Error(`No provider registered for ${config.provider}`);
    }

    const limits = getRateLimitForConfig(config as LLMConfigWithId);
    const key = config.id ?? `${config.provider}:${config.model}:${config.endpoint ?? "default"}`;
    await getDefaultRateLimiter().acquire(key, limits, context);

    let apiKey =
      (await this.resolveSecret?.(config.apiKeyRef)) ??
      (typeof config.extra?.apiKey === "string" ? config.extra.apiKey : undefined);

    // Fallback: OpenRouter often used with env var when key is stored in provider settings but not yet available
    if (!apiKey && config.provider === "openrouter" && typeof process !== "undefined" && process.env?.OPENROUTER_API_KEY) {
      apiKey = process.env.OPENROUTER_API_KEY;
    }

    const response = await provider.chat({ ...config, apiKey }, request);

    const totalTokens = response.usage?.promptTokens != null && response.usage?.completionTokens != null
      ? response.usage.promptTokens + response.usage.completionTokens
      : 0;
    if (totalTokens > 0 && limits.tokensPerMinute != null) {
      getDefaultRateLimiter().recordTokens(key, totalTokens);
    }

    return response;
  }
}

export const createDefaultLLMManager = (resolveSecret?: SecretResolver) => {
  const manager = new LLMManager(resolveSecret);
  manager.registerDefaults();
  return manager;
};
