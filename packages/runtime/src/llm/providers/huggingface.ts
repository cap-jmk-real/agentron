import type { LLMProviderAdapter } from "../types";
import { openAICompatibleChat } from "./openai-compatible";

export const huggingfaceProvider: LLMProviderAdapter = {
  provider: "huggingface",
  chat: async (config, request) => {
    if (!config.apiKey) {
      throw new Error("Hugging Face API token is required.");
    }

    const endpoint = config.endpoint ?? "https://api-inference.huggingface.co";

    return openAICompatibleChat(endpoint, config, request, {
      Authorization: `Bearer ${config.apiKey}`,
    });
  },
};
