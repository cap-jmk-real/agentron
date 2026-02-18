/**
 * Pure helpers used by the chat route. Exported for unit testing.
 */

/** Call LLM with a strict prompt to normalize option labels to a JSON array of strings so the frontend can parse them reliably. Returns original options on parse failure or error. */
export async function normalizeOptionsWithLLM(
  callLLM: (prompt: string) => Promise<string>,
  options: string[]
): Promise<string[]> {
  if (!Array.isArray(options) || options.length === 0) return options;
  const capped = options.slice(0, 6);
  const prompt = `Output ONLY a JSON array of strings: option labels (2-8 words each). At most 4 options. Input: ${JSON.stringify(capped)}\nJSON array only:`;
  try {
    const content = await callLLM(prompt);
    const match = content.trim().match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]) as unknown;
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
        return parsed.map((s) => String(s).trim()).filter(Boolean).slice(0, 4);
      }
    }
  } catch {
    // fall through to return original
  }
  return options;
}

/** When content asks the user to pick/choose but no ask_user is in toolResults, extract option labels via LLM so we can inject a synthetic ask_user. Returns null if content does not suggest options or extraction fails. */
export async function extractOptionsFromContentWithLLM(
  content: string,
  callLLM: (prompt: string) => Promise<string>
): Promise<string[] | null> {
  const trimmed = (content ?? "").trim();
  if (trimmed.length < 20) return null;
  if (!/\b(pick one|choose one|please pick|which option|options for|what (would you )?like|please (choose|reply)|e\.g\.\s*["'])/i.test(trimmed)) return null;
  const prompt = `Output ONLY a JSON array of strings: at most 4 option labels the user can choose (2-8 words each). If none or unclear, output [].\n\nMessage:\n${trimmed.slice(0, 6000)}\n\nJSON array only:`;
  try {
    const out = await callLLM(prompt);
    const match = out.trim().match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]) as unknown;
      if (Array.isArray(parsed) && parsed.length >= 1) {
        const labels = parsed.filter((x) => typeof x === "string").map((s) => String(s).trim()).filter(Boolean).slice(0, 4);
        return labels.length >= 1 ? labels : null;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

/** Normalize ask_user options in tool results via strict LLM formatting. Returns new array with ask_user results having options replaced by LLM-normalized labels. */
export async function normalizeAskUserOptionsInToolResults(
  toolResults: { name: string; args: Record<string, unknown>; result: unknown }[],
  callLLM: (prompt: string) => Promise<string>
): Promise<{ name: string; args: Record<string, unknown>; result: unknown }[]> {
  const out: { name: string; args: Record<string, unknown>; result: unknown }[] = [];
  for (const r of toolResults) {
    if (r.name === "ask_user" && r.result && typeof r.result === "object") {
      const obj = r.result as { question?: string; options?: unknown[] };
      const options = Array.isArray(obj.options) ? obj.options.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean) : [];
      if (options.length > 0) {
        const normalized = await normalizeOptionsWithLLM(callLLM, options);
        out.push({ ...r, result: { ...obj, options: normalized } });
        continue;
      }
    }
    out.push(r);
  }
  return out;
}

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

/** Extract ask_user question from tool results or persisted toolCalls so history retains context. */
export function getAskUserQuestionFromToolResults(
  toolResults: { name: string; result?: unknown }[] | undefined
): string | undefined {
  if (!Array.isArray(toolResults)) return undefined;
  const askUser = toolResults.find((r) => r.name === "ask_user" || r.name === "ask_credentials");
  const res = askUser?.result;
  if (res && typeof res === "object" && res !== null && "question" in res && typeof (res as { question: unknown }).question === "string") {
    const q = (res as { question: string }).question.trim();
    return q || undefined;
  }
  return undefined;
}

/** When the assistant only called ask_user (no other text), use the question as the chat response. */
export function getAssistantDisplayContent(
  content: string,
  toolResults: { name: string; args: Record<string, unknown>; result: unknown }[]
): string {
  const formatResp = toolResults.find((r) => r.name === "format_response");
  const res = formatResp?.result;
  const usedAnswerQuestion = toolResults.some((r) => r.name === "answer_question");
  const contentTrimmed = content.trim();

  if (res && typeof res === "object" && res !== null && "formatted" in res && (res as { formatted?: boolean }).formatted === true) {
    const obj = res as { summary?: string; needsInput?: string };
    const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
    const needsInput = typeof obj.needsInput === "string" ? obj.needsInput.trim() : "";
    if (usedAnswerQuestion && contentTrimmed.length > 150 && contentTrimmed.length > summary.length) {
      return needsInput ? `${contentTrimmed}\n\n${needsInput}` : contentTrimmed;
    }
    if (summary) return needsInput ? `${summary}\n\n${needsInput}` : summary;
  }
  if (contentTrimmed) return content;
  const q = getAskUserQuestionFromToolResults(toolResults);
  return q ?? content;
}

/** Derive turn status and interactive prompt from tool results for done event. */
export function getTurnStatusFromToolResults(
  toolResults: { name: string; args: Record<string, unknown>; result: unknown }[]
): { status: "completed" | "waiting_for_input"; interactivePrompt?: { question: string; options?: string[] } } {
  const askUser = toolResults.find((r) => r.name === "ask_user" || r.name === "ask_credentials");
  const askRes = askUser?.result;
  if (askRes && typeof askRes === "object" && askRes !== null) {
    const obj = askRes as { waitingForUser?: boolean; question?: string; options?: unknown[] };
    if (obj.waitingForUser === true) {
      const question = typeof obj.question === "string" ? obj.question.trim() : "Please provide the information or confirmation.";
      const options = Array.isArray(obj.options)
        ? obj.options.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim())
        : undefined;
      return { status: "waiting_for_input", interactivePrompt: { question, options } };
    }
  }
  const formatResp = toolResults.find((r) => r.name === "format_response");
  const fmtRes = formatResp?.result;
  if (fmtRes && typeof fmtRes === "object" && fmtRes !== null) {
    const obj = fmtRes as { formatted?: boolean; summary?: string; needsInput?: string; options?: unknown[] };
    if (obj.formatted === true) {
      const hasOptions = Array.isArray(obj.options) && obj.options.length > 0;
      const hasNeedsInput = typeof obj.needsInput === "string" && obj.needsInput.trim().length > 0;
      if (hasOptions || hasNeedsInput) {
        const options = hasOptions
          ? (obj.options as unknown[]).filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim())
          : [];
        const question = [obj.summary, obj.needsInput].filter(Boolean).join("\n\n").trim() || "Choose an option:";
        return { status: "waiting_for_input", interactivePrompt: { question, options } };
      }
    }
  }
  return { status: "completed" };
}

/** True when tool results include ask_user/ask_credentials or format_response in a "waiting for input" state. Used to create chat notifications and matches pending-input API logic. */
export function hasWaitingForInputInToolResults(
  toolResults: { name: string; result?: unknown }[]
): boolean {
  return toolResults.some((r) => {
    if (r.name === "ask_user" || r.name === "ask_credentials") {
      const res = r.result;
      if (!res || typeof res !== "object") return false;
      const obj = res as Record<string, unknown>;
      if (obj.waitingForUser === true) return true;
      if (Array.isArray(obj.options) && obj.options.length > 0) return true;
      return false;
    }
    if (r.name === "format_response") {
      const res = r.result;
      if (!res || typeof res !== "object") return false;
      const obj = res as { formatted?: boolean; needsInput?: string };
      if (obj.formatted !== true) return false;
      if (typeof obj.needsInput === "string" && obj.needsInput.trim()) return true;
      return false;
    }
    return false;
  });
}

export type LastAssistantDeleteConfirmContext = {
  agentIds: string[];
  workflowIds: string[];
  firstOption: string;
};

/** If the last message has list_agents, list_workflows, ask_user with options, return ids and first option for server-side delete confirm. */
export function getLastAssistantDeleteConfirmContext(
  lastRow: { role: string; toolCalls?: string | null } | undefined
): LastAssistantDeleteConfirmContext | null {
  if (!lastRow || lastRow.role !== "assistant" || !lastRow.toolCalls) return null;
  let parsed: unknown;
  try {
    parsed = typeof lastRow.toolCalls === "string" ? JSON.parse(lastRow.toolCalls) : null;
  } catch {
    return null;
  }
  const toolResults = Array.isArray(parsed) ? (parsed as { name: string; result?: unknown }[]) : [];
  const listAgents = toolResults.find((r) => r.name === "list_agents");
  const listWorkflows = toolResults.find((r) => r.name === "list_workflows");
  const askUser = toolResults.find((r) => r.name === "ask_user");
  const agentIds = Array.isArray(listAgents?.result)
    ? (listAgents.result as { id?: string }[]).map((x) => x.id).filter((id): id is string => typeof id === "string")
    : [];
  const workflowIds = Array.isArray(listWorkflows?.result)
    ? (listWorkflows.result as { id?: string }[]).map((x) => x.id).filter((id): id is string => typeof id === "string")
    : [];
  const options =
    askUser?.result && typeof askUser.result === "object" && askUser.result !== null && "options" in askUser.result
      ? Array.isArray((askUser.result as { options?: unknown }).options)
        ? ((askUser.result as { options: unknown[] }).options.filter((o): o is string => typeof o === "string") as string[])
        : []
      : [];
  const firstOption = options[0]?.trim();
  if (!firstOption || (agentIds.length === 0 && workflowIds.length === 0)) return null;
  return { agentIds, workflowIds, firstOption };
}

export function userMessageMatchesFirstOption(userTrim: string, firstOption: string): boolean {
  return userTrim === firstOption || userTrim.toLowerCase() === firstOption.toLowerCase();
}
