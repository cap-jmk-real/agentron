/**
 * Pure helpers used by the chat route. Exported for unit testing.
 */

/** Build a one-line context prefix for stack traces: provider, model, endpoint. */
export function llmContextPrefix(config: { provider: string; model: string; endpoint?: string | null }): string {
  const parts = [`Provider: ${config.provider}`, `Model: ${config.model}`];
  if (config.endpoint && config.endpoint.trim()) parts.push(`Endpoint: ${config.endpoint.trim()}`);
  return `[${parts.join(", ")}] `;
}

const OPENAI_API_REF = "https://platform.openai.com/docs/api-reference";
const OPENAI_DOCS = "https://platform.openai.com/docs/overview";

/** Turn low-level fetch/network errors into a user-friendly message. Optionally prefix with provider/model/endpoint for stack traces. */
export function normalizeChatError(
  err: unknown,
  llmContext?: { provider: string; model: string; endpoint?: string | null }
): string {
  const msg = err instanceof Error ? err.message : String(err);
  let normalized: string;
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network/i.test(msg)) {
    normalized = "Could not reach the LLM. Check that the provider endpoint in Settings → LLM Providers is correct and that the service is running.";
  } else if (/Cannot convert undefined or null to object/i.test(msg)) {
    normalized = `${msg} (This is a tool execution bug, not a connection issue. If a tool name appears before the message, that tool failed.)`;
  } else {
    normalized = msg;
  }
  let out = llmContext ? llmContextPrefix(llmContext) + normalized : normalized;
  if (llmContext?.provider === "openai" && /404/.test(normalized)) {
    out += `\n\nOpenAI API reference: ${OPENAI_API_REF} | Docs: ${OPENAI_DOCS}`;
  }
  return out;
}
