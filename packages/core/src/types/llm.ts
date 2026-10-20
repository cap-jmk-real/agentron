export type LLMProvider =
  | "local"
  | "openai"
  | "anthropic"
  | "azure"
  | "azure_openai_eu"
  | "gcp"
  | "openrouter"
  | "huggingface"
  | "custom_http";

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  apiKeyRef?: string;
  endpoint?: string;
  extra?: Record<string, unknown>;
}
