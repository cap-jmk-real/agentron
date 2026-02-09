import type { LLMProviderAdapter } from "../types";
import { openAICompatibleChat } from "./openai-compatible";

export const customHttpProvider: LLMProviderAdapter = {
  provider: "custom_http",
  chat: async (config, request) => {
    if (!config.endpoint) {
      throw new Error("Custom HTTP provider requires an endpoint.");
    }

    return openAICompatibleChat(config.endpoint, config, request, {});
  }
};
