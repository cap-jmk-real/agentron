import type { LLMProviderAdapter } from "../types";
import { openAICompatibleChat } from "./openai-compatible";

export const gcpProvider: LLMProviderAdapter = {
  provider: "gcp",
  chat: async (config, request) => {
    if (!config.endpoint) {
      throw new Error("GCP provider requires an endpoint.");
    }

    const headers: Record<string, string> = {};
    if (config.apiKey) {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }

    return openAICompatibleChat(config.endpoint, config, request, headers);
  }
};
