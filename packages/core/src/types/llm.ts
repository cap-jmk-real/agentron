/**
 * LLM types: provider enum and config.
 * Used by the runtime and API for LLM provider CRUD and request/response.
 *
 * @packageDocumentation
 */

/** Supported LLM provider identifiers. */
export type LLMProvider =
  | "local"
  | "openai"
  | "anthropic"
  | "azure"
  | "gcp"
  | "openrouter"
  | "huggingface"
  | "custom_http";

/** LLM configuration: provider, model, optional API key ref, endpoint, and extra options. */
export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  apiKeyRef?: string;
  endpoint?: string;
  extra?: Record<string, unknown>;
}
