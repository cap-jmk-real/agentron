import type { LLMProviderAdapter } from "../types";
import { openAICompatibleChat } from "./openai-compatible";

export const openaiProvider: LLMProviderAdapter = {
  provider: "openai",
  chat: async (config, request) => {
    const endpoint = config.endpoint ?? "https://api.openai.com";
    if (!config.apiKey) {
      throw new Error("OpenAI API key is required.");
    }

    return openAICompatibleChat(endpoint, config, request, {
      Authorization: `Bearer ${config.apiKey}`
    });
  }
};
