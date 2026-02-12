export interface CatalogModel {
  id: string;
  name: string;
  provider: string;
  contextLength?: number;
  parameterSize?: string;
  pricing?: { input: number; output: number };
}

export const MODEL_CATALOG: Record<string, CatalogModel[]> = {
  // Model IDs from https://platform.openai.com/docs/models
  openai: [
    { id: "gpt-5.2", name: "GPT-5.2", provider: "openai", contextLength: 128000, pricing: { input: 1.75, output: 14.00 } },
    { id: "gpt-5-mini", name: "GPT-5 mini", provider: "openai", contextLength: 128000, pricing: { input: 0.25, output: 2.00 } },
    { id: "gpt-5-nano", name: "GPT-5 nano", provider: "openai", contextLength: 128000 },
    { id: "gpt-5.1", name: "GPT-5.1", provider: "openai", contextLength: 128000 },
    { id: "gpt-5", name: "GPT-5", provider: "openai", contextLength: 128000 },
    { id: "gpt-5.2-pro", name: "GPT-5.2 pro", provider: "openai", contextLength: 128000 },
    { id: "gpt-4.1", name: "GPT-4.1", provider: "openai", contextLength: 128000 },
    { id: "gpt-4.1-mini", name: "GPT-4.1 mini", provider: "openai", contextLength: 128000 },
    { id: "gpt-4o", name: "GPT-4o", provider: "openai", contextLength: 128000, pricing: { input: 2.50, output: 10.00 } },
    { id: "gpt-4o-mini", name: "GPT-4o mini", provider: "openai", contextLength: 128000, pricing: { input: 0.15, output: 0.60 } },
    { id: "o3-mini", name: "o3-mini", provider: "openai", contextLength: 200000, pricing: { input: 1.10, output: 4.40 } },
    { id: "o3", name: "o3", provider: "openai", contextLength: 200000 },
    { id: "o4-mini", name: "o4-mini", provider: "openai", contextLength: 200000 },
    { id: "o1", name: "o1", provider: "openai", contextLength: 200000, pricing: { input: 15.00, output: 60.00 } },
    { id: "o1-mini", name: "o1-mini", provider: "openai", contextLength: 128000, pricing: { input: 1.10, output: 4.40 } },
  ],
  anthropic: [
    { id: "claude-opus-4.5", name: "Claude Opus 4.5", provider: "anthropic", contextLength: 200000, pricing: { input: 5.00, output: 25.00 } },
    { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5", provider: "anthropic", contextLength: 200000, pricing: { input: 3.00, output: 15.00 } },
    { id: "claude-haiku-4.5", name: "Claude Haiku 4.5", provider: "anthropic", contextLength: 200000, pricing: { input: 1.00, output: 5.00 } },
    { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet", provider: "anthropic", contextLength: 200000, pricing: { input: 6.00, output: 30.00 } },
    { id: "claude-3.5-haiku", name: "Claude 3.5 Haiku", provider: "anthropic", contextLength: 200000, pricing: { input: 0.80, output: 4.00 } },
  ],
  openrouter: [
    // Free tier (OpenRouter routes to a free model)
    { id: "openrouter/free", name: "Free (OpenRouter)", provider: "openrouter", contextLength: 128000 },
    // OpenAI via OpenRouter
    { id: "openai/gpt-4o", name: "GPT-4o", provider: "openrouter", contextLength: 128000, pricing: { input: 2.50, output: 10.00 } },
    { id: "openai/gpt-4o-mini", name: "GPT-4o Mini", provider: "openrouter", contextLength: 128000, pricing: { input: 0.15, output: 0.60 } },
    // Anthropic via OpenRouter
    { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5", provider: "openrouter", contextLength: 200000, pricing: { input: 3.00, output: 15.00 } },
    // DeepSeek
    { id: "deepseek/deepseek-chat", name: "DeepSeek V3", provider: "openrouter", contextLength: 64000, pricing: { input: 0.27, output: 1.10 } },
    { id: "deepseek/deepseek-r1", name: "DeepSeek R1", provider: "openrouter", contextLength: 64000, pricing: { input: 0.70, output: 2.50 } },
    { id: "deepseek/deepseek-r1-distill-qwen-32b", name: "DeepSeek R1 Distill Qwen 32B", provider: "openrouter", contextLength: 32000, pricing: { input: 0.29, output: 0.29 } },
    // Qwen
    { id: "qwen/qwen-2.5-72b-instruct", name: "Qwen 2.5 72B", provider: "openrouter", contextLength: 131072 },
    { id: "qwen/qwen-2.5-coder-32b-instruct", name: "Qwen 2.5 Coder 32B", provider: "openrouter", contextLength: 32768 },
    { id: "qwen/qwen-2.5-7b-instruct", name: "Qwen 2.5 7B", provider: "openrouter", contextLength: 131072 },
    // Mistral
    { id: "mistralai/mistral-large-2512", name: "Mistral Large 3", provider: "openrouter", contextLength: 262000, pricing: { input: 0.50, output: 1.50 } },
    { id: "mistralai/mistral-small-3.1-24b", name: "Mistral Small 3.1", provider: "openrouter", contextLength: 96000, pricing: { input: 0.03, output: 0.11 } },
    // Meta Llama
    { id: "meta-llama/llama-3.1-405b-instruct", name: "Llama 3.1 405B", provider: "openrouter", contextLength: 131072, pricing: { input: 3.50, output: 3.50 } },
    { id: "meta-llama/llama-3.1-70b-instruct", name: "Llama 3.1 70B", provider: "openrouter", contextLength: 131072 },
    { id: "meta-llama/llama-3.1-8b-instruct", name: "Llama 3.1 8B", provider: "openrouter", contextLength: 131072 },
    // Google via OpenRouter
    { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "openrouter", contextLength: 1000000, pricing: { input: 1.25, output: 10.00 } },
    { id: "google/gemini-2.0-flash", name: "Gemini 2.0 Flash", provider: "openrouter", contextLength: 1000000, pricing: { input: 0.30, output: 2.50 } },
  ],
  // Local/Ollama: typical num_ctx 2k–32k by model; default 32k is a safe upper bound (user can lower in provider settings)
  local: [
    { id: "llama3.1:8b", name: "Llama 3.1 8B", provider: "local", parameterSize: "8B", contextLength: 32768 },
    { id: "llama3.1:70b", name: "Llama 3.1 70B", provider: "local", parameterSize: "70B", contextLength: 32768 },
    { id: "qwen2.5:7b", name: "Qwen 2.5 7B", provider: "local", parameterSize: "7B", contextLength: 32768 },
    { id: "qwen2.5:32b", name: "Qwen 2.5 32B", provider: "local", parameterSize: "32B", contextLength: 32768 },
    { id: "deepseek-coder-v2:16b", name: "DeepSeek Coder V2 16B", provider: "local", parameterSize: "16B", contextLength: 32768 },
    { id: "mistral:7b", name: "Mistral 7B", provider: "local", parameterSize: "7B", contextLength: 32768 },
    { id: "codellama:7b", name: "CodeLlama 7B", provider: "local", parameterSize: "7B", contextLength: 16384 },
    { id: "phi3:14b", name: "Phi-3 14B", provider: "local", parameterSize: "14B", contextLength: 4096 },
    { id: "gemma2:9b", name: "Gemma 2 9B", provider: "local", parameterSize: "9B", contextLength: 8192 },
  ],
  gcp: [
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "gcp", contextLength: 1000000, pricing: { input: 1.25, output: 10.00 } },
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", provider: "gcp", contextLength: 1000000, pricing: { input: 0.30, output: 2.50 } },
    { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite", provider: "gcp", contextLength: 1000000, pricing: { input: 0.10, output: 0.40 } },
  ],
  azure: [
    { id: "gpt-4o", name: "GPT-4o", provider: "azure", contextLength: 128000 },
    { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "azure", contextLength: 128000 },
  ],
  huggingface: [],
  custom_http: [],
};

export function getModelsForProvider(provider: string): CatalogModel[] {
  return MODEL_CATALOG[provider] ?? [];
}

/** Default context length (tokens) for a provider/model from the catalog. Use when a provider has no explicit contextLength set. */
export function getDefaultContextLengthForModel(provider: string, model: string): number | undefined {
  const list = MODEL_CATALOG[provider];
  if (!list) return undefined;
  const entry = list.find((m) => m.id === model || model.startsWith(m.id.split(":")[0]));
  return entry?.contextLength;
}
