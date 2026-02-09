import { OpenRouter } from "@openrouter/sdk";
import type { LLMProviderAdapter } from "../types";
import type { LLMMessage, LLMRequest, LLMResponse, ResolvedLLMConfig } from "../types";

const SITE_URL = "https://agentos.studio";
const SITE_NAME = "AgentOS Studio";

/** Map our LLMMessage to OpenRouter SDK message shape. */
function toSDKMessages(
  messages: LLMMessage[]
): Array<
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | { role: "tool"; content: string; toolCallId: string }
> {
  return messages.map((m) => {
    if (m.role === "tool") {
      return { role: "tool" as const, content: m.content, toolCallId: "call_0" };
    }
    return { role: m.role, content: m.content };
  });
}

function getOpenRouterApiKey(config: ResolvedLLMConfig): string | undefined {
  if (config.apiKey && config.apiKey.trim().length > 0) return config.apiKey;
  if (typeof process !== "undefined" && process.env?.OPENROUTER_API_KEY?.trim()) {
    return process.env.OPENROUTER_API_KEY.trim();
  }
  return undefined;
}

export const openrouterProvider: LLMProviderAdapter = {
  provider: "openrouter",
  chat: async (config, request): Promise<LLMResponse> => {
    const apiKey = getOpenRouterApiKey(config);
    if (!apiKey) {
      throw new Error(
        "OpenRouter API key is required. Set it in Settings → LLM Providers (edit your OpenRouter provider and enter the key), or set the OPENROUTER_API_KEY environment variable."
      );
    }

    const openRouter = new OpenRouter({
      apiKey,
      httpReferer: SITE_URL,
      xTitle: SITE_NAME,
    });

    const completion = await openRouter.chat.send({
      model: config.model ?? "openrouter/free",
      messages: toSDKMessages(request.messages),
      stream: false,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      topP: request.topP,
    });

    const choice = completion.choices?.[0];
    const msg = choice?.message;
    const rawContent = msg?.content;
    const content =
      typeof rawContent === "string"
        ? rawContent
        : Array.isArray(rawContent)
          ? (rawContent as { type?: string; text?: string }[])
              .filter((c) => c?.type === "output_text" && "text" in c)
              .map((c) => (c as { text: string }).text)
              .join("")
          : "";

    const usage = completion.usage;

    return {
      id: completion.id ?? "unknown",
      content,
      usage: usage
        ? {
            promptTokens: usage.promptTokens ?? 0,
            completionTokens: usage.completionTokens ?? 0,
            totalTokens: usage.totalTokens ?? (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0),
          }
        : undefined,
      raw: completion,
    };
  },
};
