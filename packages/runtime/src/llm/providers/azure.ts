import type { LLMProviderAdapter } from "../types";
import { openAICompatibleChat } from "./openai-compatible";

export const azureProvider: LLMProviderAdapter = {
  provider: "azure",
  chat: async (config, request) => {
    if (!config.endpoint) {
      throw new Error("Azure provider requires an endpoint.");
    }
    if (!config.apiKey) {
      throw new Error("Azure API key is required.");
    }

    return openAICompatibleChat(config.endpoint, config, request, {
      "api-key": config.apiKey
    });
  }
};
