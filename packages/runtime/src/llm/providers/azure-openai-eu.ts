import type { LLMProviderAdapter } from "../types";
import {
  resolveAzureOpenAiEuApiVersion,
  resolveAzureOpenAiEuEndpoint,
} from "../presets/azure-openai-eu-si";
import { azureOpenAIDeploymentChat } from "./openai-compatible";

export const azureOpenAiEuProvider: LLMProviderAdapter = {
  provider: "azure_openai_eu",
  chat: async (config, request) => {
    const endpoint = config.endpoint ?? resolveAzureOpenAiEuEndpoint();
    if (!endpoint) {
      throw new Error(
        "Azure OpenAI (EU Data Zone) requires an endpoint (Settings or AZURE_OPENAI_EU_ENDPOINT)."
      );
    }
    if (!config.apiKey) {
      throw new Error(
        "Azure OpenAI (EU Data Zone) API key is required (Settings or AZURE_OPENAI_EU_API_KEY)."
      );
    }
    if (!config.model?.trim()) {
      throw new Error("Azure OpenAI (EU Data Zone) requires a deployment name as the model.");
    }

    const apiVersion =
      typeof config.extra?.azureApiVersion === "string" && config.extra.azureApiVersion.trim()
        ? config.extra.azureApiVersion.trim()
        : resolveAzureOpenAiEuApiVersion();

    return azureOpenAIDeploymentChat(
      endpoint,
      config,
      request,
      { "api-key": config.apiKey },
      apiVersion,
      { useMaxCompletionTokens: true }
    );
  },
};
