/**
 * LLM manager: registry of provider adapters and chat() with rate limiting and secret resolution.
 *
 * @packageDocumentation
 */
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

/** Resolves a secret reference (e.g. vault id) to the actual API key. */
export type SecretResolver = (ref?: string) => Promise<string | undefined>;

/**
 * Registry of LLM provider adapters. Resolves secrets, applies rate limits, and delegates chat to the right provider.
 */
export class LLMManager {
  private providers = new Map<LLMProvider, LLMProviderAdapter>();
  private resolveSecret?: SecretResolver;

  /** @param resolveSecret - Optional resolver for apiKeyRef (e.g. vault lookup) */
  constructor(resolveSecret?: SecretResolver) {
    this.resolveSecret = resolveSecret;
  }

  /** Register an adapter for a provider; replaces any existing adapter for that provider. */
  register(provider: LLMProviderAdapter) {
    this.providers.set(provider.provider, provider);
  }

  /** Register all built-in providers (local, openai, anthropic, azure, gcp, openrouter, huggingface, custom_http). */
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

  /**
   * Send a chat request to the provider for the given config. Applies rate limiting and resolves API key.
   * @param config - LLM config (provider, model, etc.) with optional id for rate-limit key
   * @param request - Messages, temperature, maxTokens, optional tools
   * @param context - Optional context for rate-limit queue (source, workflowId, etc.)
   * @returns Promise resolving to LLMResponse (content, toolCalls, usage)
   * @throws Error if no adapter is registered for config.provider
   */
  async chat(
    config: LLMConfig & { id?: string },
    request: LLMRequest,
    context?: LLMRequestContext
  ): Promise<LLMResponse> {
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
    if (
      !apiKey &&
      config.provider === "openrouter" &&
      typeof process !== "undefined" &&
      process.env?.OPENROUTER_API_KEY
    ) {
      apiKey = process.env.OPENROUTER_API_KEY;
    }

    const response = await provider.chat({ ...config, apiKey }, request);

    const totalTokens =
      response.usage?.promptTokens != null && response.usage?.completionTokens != null
        ? response.usage.promptTokens + response.usage.completionTokens
        : 0;
    if (totalTokens > 0 && limits.tokensPerMinute != null) {
      getDefaultRateLimiter().recordTokens(key, totalTokens);
    }

    return response;
  }
}

/**
 * Create an LLMManager with all built-in providers registered.
 * @param resolveSecret - Optional resolver for apiKeyRef
 * @returns LLMManager ready for chat()
 */
export const createDefaultLLMManager = (resolveSecret?: SecretResolver) => {
  const manager = new LLMManager(resolveSecret);
  manager.registerDefaults();
  return manager;
};
