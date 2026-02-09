/**
 * Default model pricing in USD per 1M tokens.
 * Users can override these via the model_pricing DB table.
 * Researched Feb 2026.
 */
export const DEFAULT_MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // --- OpenAI ---
  "gpt-5.2":           { input: 1.75,  output: 14.00 },
  "gpt-5-mini":        { input: 0.25,  output: 2.00 },
  "gpt-4o":            { input: 2.50,  output: 10.00 },
  "gpt-4o-mini":       { input: 0.15,  output: 0.60 },
  "o3-mini":           { input: 1.10,  output: 4.40 },
  "o1":                { input: 15.00, output: 60.00 },
  "o1-mini":           { input: 1.10,  output: 4.40 },

  // --- Anthropic ---
  "claude-opus-4.5":   { input: 5.00,  output: 25.00 },
  "claude-sonnet-4.5": { input: 3.00,  output: 15.00 },
  "claude-haiku-4.5":  { input: 1.00,  output: 5.00 },
  "claude-3.5-haiku":  { input: 0.80,  output: 4.00 },
  "claude-3.5-sonnet": { input: 6.00,  output: 30.00 },

  // --- Google Gemini ---
  "gemini-2.5-pro":        { input: 1.25,  output: 10.00 },
  "gemini-2.0-flash":      { input: 0.30,  output: 2.50 },
  "gemini-2.5-flash-lite": { input: 0.10,  output: 0.40 },

  // --- DeepSeek ---
  "deepseek-chat":     { input: 0.27,  output: 1.10 },
  "deepseek-r1":       { input: 0.70,  output: 2.50 },

  // --- Mistral ---
  "mistral-large-2512": { input: 0.50,  output: 1.50 },
  "mistral-small-3.1":  { input: 0.03,  output: 0.11 },
  "mistral-nemo":       { input: 0.02,  output: 0.04 },

  // --- Meta Llama (OpenRouter) ---
  "llama-3.1-405b-instruct": { input: 3.50,  output: 3.50 },

  // --- Qwen (OpenRouter) ---
  "deepseek-r1-distill-qwen-32b": { input: 0.29, output: 0.29 },
};

/**
 * Resolve pricing for a given model name.
 * Checks custom overrides first, then default map with fuzzy matching.
 */
export function resolveModelPricing(
  model: string,
  customOverrides?: Record<string, { input: number; output: number }>
): { input: number; output: number } {
  // 1) Check custom overrides (exact)
  if (customOverrides?.[model]) return customOverrides[model];

  // 2) Check defaults (exact)
  if (DEFAULT_MODEL_PRICING[model]) return DEFAULT_MODEL_PRICING[model];

  // 3) Fuzzy: try stripping version suffixes, dates, etc.
  const normalized = model.replace(/[-:][0-9]{4,}.*$/, "").replace(/:latest$/, "");
  if (DEFAULT_MODEL_PRICING[normalized]) return DEFAULT_MODEL_PRICING[normalized];

  // 4) Fuzzy: check if any key is a substring of the model name
  for (const [key, pricing] of Object.entries(customOverrides ?? {})) {
    if (model.includes(key)) return pricing;
  }
  for (const [key, pricing] of Object.entries(DEFAULT_MODEL_PRICING)) {
    if (model.includes(key)) return pricing;
  }

  return { input: 0, output: 0 };
}

/**
 * Calculate estimated cost in USD from token counts and pricing.
 */
export function calculateCost(
  promptTokens: number,
  completionTokens: number,
  pricing: { input: number; output: number }
): number {
  return (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000;
}
