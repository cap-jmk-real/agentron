import type { LLMRequest, LLMResponse, ResolvedLLMConfig } from "../types";

type OpenAIChatResponse = {
  id: string;
  choices?: Array<{
    message?: {
      /** String (legacy) or array of parts (e.g. [{ type: "text", text: "..." }]) in newer APIs */
      content?: string | Array<{ type?: string; text?: string }>;
      tool_calls?: Array<{
        id: string;
        type: string;
        function?: { name: string; arguments: string };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

/** Normalize OpenAI-style content (string or array of parts) to a single string for LLMResponse.content */
function normalizeContent(
  raw: string | Array<{ type?: string; text?: string }> | undefined
): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  if (!Array.isArray(raw)) return String(raw);
  return raw
    .map((part) =>
      part && typeof part === "object" && typeof part.text === "string" ? part.text : ""
    )
    .filter(Boolean)
    .join("");
}

/** Ensure base URL has no trailing /v1 so we can append /v1/chat/completions once. */
function normalizeOpenAIEndpoint(endpoint: string): string {
  return endpoint.replace(/\/v1\/?$/, "").replace(/\/$/, "") || endpoint;
}

/** Models that require max_completion_tokens instead of max_tokens (OpenAI API). */
function modelRequiresMaxCompletionTokens(model: string): boolean {
  const m = (model || "").toLowerCase();
  return (
    m.startsWith("gpt-5") ||
    m.startsWith("o1") ||
    m.startsWith("o3") ||
    m.startsWith("o4") ||
    /^o\d+-mini$/i.test(m)
  );
}

export type OpenAICompatibleOptions = {
  /** Use max_completion_tokens instead of max_tokens (required for newer OpenAI models e.g. gpt-5-mini). */
  useMaxCompletionTokens?: boolean;
};

function buildRequestBody(
  request: LLMRequest,
  config: ResolvedLLMConfig,
  temperatureOverride?: number,
  options?: OpenAICompatibleOptions
) {
  const temperature = temperatureOverride ?? request.temperature;
  const useMaxCompletionTokens =
    options?.useMaxCompletionTokens === true || modelRequiresMaxCompletionTokens(config.model);
  const completionLimit =
    request.maxTokens !== undefined && request.maxTokens !== null
      ? useMaxCompletionTokens
        ? { max_completion_tokens: request.maxTokens }
        : { max_tokens: request.maxTokens }
      : {};
  return {
    model: config.model,
    messages: mapMessagesToApi(request.messages ?? []),
    ...(temperature !== undefined && temperature !== null ? { temperature } : {}),
    top_p: request.topP,
    ...completionLimit,
    ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {}),
  };
}

export const openAICompatibleChat = async (
  endpoint: string,
  config: ResolvedLLMConfig,
  request: LLMRequest,
  headers: Record<string, string>,
  options?: OpenAICompatibleOptions
): Promise<LLMResponse> => {
  const base = normalizeOpenAIEndpoint(endpoint);
  let body = buildRequestBody(request, config, undefined, options);
  let response = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let errorText = await response.text();
    if (response.status === 400) {
      try {
        const err = JSON.parse(errorText) as { error?: { param?: string; code?: string } };
        if (err.error?.param === "temperature" && err.error?.code === "unsupported_value") {
          body = buildRequestBody(request, config, 1, options);
          response = await fetch(`${base}/v1/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...headers },
            body: JSON.stringify(body),
          });
          if (!response.ok) errorText = await response.text();
        }
      } catch {
        // ignore parse error, throw original below
      }
    }
    if (!response.ok) {
      let hint = "";
      if (response.status === 404) {
        hint =
          " For 404: check that the model name is supported by your provider and that the endpoint URL in Settings → LLM Providers is correct.";
      }
      throw new Error(`LLM request failed (${response.status}): ${errorText}${hint}`);
    }
  }

  const data = (await response.json()) as OpenAIChatResponse;
  const msg = data.choices?.[0]?.message;
  const content = normalizeContent(msg?.content);

  const rawToolCalls = msg?.tool_calls ?? [];
  const toolCalls = rawToolCalls
    .filter((tc) => tc.function?.name)
    .map((tc) => ({
      id: tc.id ?? "",
      name: tc.function!.name,
      arguments: tc.function!.arguments ?? "{}",
    }));

  const promptTokens = data.usage?.prompt_tokens ?? 0;
  const completionTokens = data.usage?.completion_tokens ?? 0;

  return {
    id: data.id ?? "unknown",
    content,
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: data.usage?.total_tokens ?? promptTokens + completionTokens,
    },
    raw: data,
  };
};

/** Map internal messages (tool/toolCalls) to OpenAI API format. */
function mapMessagesToApi(
  messages: LLMRequest["messages"]
): Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: unknown[] }> {
  return messages.map((m) => {
    const base: { role: string; content: string; tool_call_id?: string; tool_calls?: unknown[] } = {
      role: m.role,
      content: m.content ?? "",
    };
    if (m.role === "tool" && m.toolCallId) base.tool_call_id = m.toolCallId;
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      base.tool_calls = m.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments },
      }));
    }
    return base;
  });
}
