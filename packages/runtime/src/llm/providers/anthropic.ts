import type { LLMProviderAdapter, LLMRequest, LLMResponse } from "../types";

type AnthropicResponse = {
  id: string;
  content?: Array<{ text?: string }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
};

const buildAnthropicPayload = (model: string, request: LLMRequest) => {
  const systemMessage = request.messages.find((msg) => msg.role === "system")?.content;
  const messages = request.messages
    .filter((msg) => msg.role !== "system")
    .map((msg) => ({
      role: msg.role === "assistant" ? "assistant" : "user",
      content: msg.content,
    }));

  return {
    model,
    system: systemMessage,
    messages,
    max_tokens: request.maxTokens ?? 1024,
    temperature: request.temperature,
  };
};

export const anthropicProvider: LLMProviderAdapter = {
  provider: "anthropic",
  chat: async (config, request) => {
    if (!config.apiKey) {
      throw new Error("Anthropic API key is required.");
    }

    const endpoint = config.endpoint ?? "https://api.anthropic.com";
    const payload = buildAnthropicPayload(config.model, request);

    const response = await fetch(`${endpoint}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM request failed (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as AnthropicResponse;
    const content = data.content?.[0]?.text ?? "";

    const promptTokens = data.usage?.input_tokens ?? 0;
    const completionTokens = data.usage?.output_tokens ?? 0;

    const result: LLMResponse = {
      id: data.id ?? "unknown",
      content,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      raw: data,
    };

    return result;
  },
};
