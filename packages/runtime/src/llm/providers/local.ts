import type { LLMProviderAdapter } from "../types";
import { openAICompatibleChat } from "./openai-compatible";

export const localProvider: LLMProviderAdapter = {
  provider: "local",
  chat: async (config, request) => {
    const endpoint = config.endpoint ?? "http://localhost:11434";

    // Pass GPU mode options if configured
    const extra = config.extra ?? {};
    const gpuMode = extra.gpuMode as string | undefined;
    const numGpuLayers = extra.numGpuLayers as number | undefined;

    // Build Ollama-specific options
    const ollamaOptions: Record<string, unknown> = {};
    if (gpuMode === "cpu") {
      ollamaOptions.num_gpu = 0;
    } else if (gpuMode === "full") {
      ollamaOptions.num_gpu = -1;
    } else if (gpuMode === "partial" && numGpuLayers != null) {
      ollamaOptions.num_gpu = numGpuLayers;
    }
    // "auto" or undefined = let Ollama decide

    // Ollama supports the OpenAI-compatible API, but we can also add options
    // For the OpenAI-compatible endpoint, options are passed via extra body params
    // However, the standard openAICompatibleChat function doesn't support this,
    // so for now we use the compatibility layer which works for most cases.
    return openAICompatibleChat(endpoint, config, request, {});
  },
};
