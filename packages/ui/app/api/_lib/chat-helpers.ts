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
        return parsed
          .map((s) => String(s).trim())
          .filter(Boolean)
          .slice(0, 4);
      }
    }
  } catch {
    // fall through to return original
  }
  return options;
}

/** Extract option labels from bullet/list lines when content clearly asks the user to choose. Exported for tests; also used as try-first before LLM in extractOptionsFromContentWithLLM. */
export function extractOptionsFromBulletList(content: string): string[] | null {
  const trimmed = (content ?? "").trim();
  if (trimmed.length < 20) return null;
  const asksToChoose =
    /\b(what would you like|pick one|choose one|choose an option|options?:|next steps?|please pick)\b/i.test(
      trimmed
    );
  if (!asksToChoose) return null;
  // Match lines that look like bullet options: "- Option", "• Option", "* Option", or " - Option"
  const bulletRegex = /^\s*[-•*]\s+(.+)$/gm;
  const options: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = bulletRegex.exec(trimmed)) !== null && options.length < 4) {
    const label = m[1].trim();
    if (label.length >= 2 && label.length <= 80) options.push(label);
  }
  return options.length >= 1 ? options.slice(0, 4) : null;
}

/** Extract option labels from content via a strict-format LLM call. Tries deterministic bullet extraction first; only calls LLM when that returns null. Use when we need to inject a synthetic ask_user and no ask_user is in toolResults. Returns null if content too short or no options found. */
export async function extractOptionsFromContentWithLLM(
  content: string,
  callLLM: (prompt: string) => Promise<string>
): Promise<string[] | null> {
  const trimmed = (content ?? "").trim();
  if (trimmed.length < 20) return null;
  const bulletOptions = extractOptionsFromBulletList(trimmed);
  if (bulletOptions !== null) return bulletOptions;
  const prompt = `Output ONLY a JSON array of strings: at most 4 option labels the user can choose (2-8 words each). Extract from the message the exact labels for clickable options the user can pick. If there are no clear options or the message does not ask the user to choose, output []. No other text.

Message:
${trimmed.slice(0, 6000)}

JSON array only:`;
  try {
    const out = await callLLM(prompt);
    const match = out.trim().match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]) as unknown;
      if (Array.isArray(parsed) && parsed.length >= 1) {
        const labels = parsed
          .filter((x) => typeof x === "string")
          .map((s) => String(s).trim())
          .filter(Boolean)
          .slice(0, 4);
        if (labels.length >= 1) return labels;
      }
    }
  } catch {
    // ignore
  }
  return extractOptionsFromBulletList(trimmed);
}

const NORMALIZE_OPTIONS_MAX_LENGTH = 50;
const NORMALIZE_OPTIONS_MAX_COUNT = 4;

/** True when options are already short and few enough to pass through without LLM normalization. */
export function areOptionsSafeForPassThrough(options: string[]): boolean {
  if (
    !Array.isArray(options) ||
    options.length === 0 ||
    options.length > NORMALIZE_OPTIONS_MAX_COUNT
  )
    return false;
  return options.every(
    (s) =>
      typeof s === "string" &&
      s.trim().length > 0 &&
      s.trim().length <= NORMALIZE_OPTIONS_MAX_LENGTH
  );
}

/** Normalize ask_user options in tool results via strict LLM formatting. Skips LLM when options are already short (≤50 chars each, ≤4); pass-through for reliability. Returns new array with ask_user results having options replaced by LLM-normalized labels when needed. */
export async function normalizeAskUserOptionsInToolResults(
  toolResults: { name: string; args: Record<string, unknown>; result: unknown }[],
  callLLM: (prompt: string) => Promise<string>
): Promise<{ name: string; args: Record<string, unknown>; result: unknown }[]> {
  const out: { name: string; args: Record<string, unknown>; result: unknown }[] = [];
  for (const r of toolResults) {
    if (r.name === "ask_user" && r.result && typeof r.result === "object") {
      const obj = r.result as { question?: string; options?: unknown[] };
      const options = Array.isArray(obj.options)
        ? obj.options
            .filter((x): x is string => typeof x === "string")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      if (options.length > 0) {
        const normalized = areOptionsSafeForPassThrough(options)
          ? options
          : await normalizeOptionsWithLLM(callLLM, options);
        out.push({ ...r, result: { ...obj, options: normalized } });
        continue;
      }
    }
    out.push(r);
  }
  return out;
}

/** Build a one-line context prefix for stack traces: provider, model, endpoint. */
export function llmContextPrefix(config: {
  provider: string;
  model: string;
  endpoint?: string | null;
}): string {
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
    normalized =
      "Could not reach the LLM. Check that the provider endpoint in Settings → LLM Providers is correct and that the service is running.";
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
  if (
    res &&
    typeof res === "object" &&
    res !== null &&
    "question" in res &&
    typeof (res as { question: unknown }).question === "string"
  ) {
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

  if (
    res &&
    typeof res === "object" &&
    res !== null &&
    "formatted" in res &&
    (res as { formatted?: boolean }).formatted === true
  ) {
    const obj = res as { summary?: string; needsInput?: string };
    const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
    const needsInput = typeof obj.needsInput === "string" ? obj.needsInput.trim() : "";
    if (
      usedAnswerQuestion &&
      contentTrimmed.length > 150 &&
      contentTrimmed.length > summary.length
    ) {
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
  toolResults: { name: string; args: Record<string, unknown>; result: unknown }[],
  options?: { useLastAskUser?: boolean }
): {
  status: "completed" | "waiting_for_input";
  interactivePrompt?: {
    question: string;
    options?: string[];
    stepIndex?: number;
    stepTotal?: number;
  };
} {
  const useLast = options?.useLastAskUser === true;
  const askUser = useLast
    ? [...toolResults].reverse().find((r) => r.name === "ask_user" || r.name === "ask_credentials")
    : toolResults.find((r) => r.name === "ask_user" || r.name === "ask_credentials");
  const askRes = askUser?.result;
  if (askRes && typeof askRes === "object" && askRes !== null) {
    const obj = askRes as {
      waitingForUser?: boolean;
      question?: string;
      options?: unknown[];
      stepIndex?: number;
      stepTotal?: number;
    };
    if (obj.waitingForUser === true) {
      const question =
        typeof obj.question === "string"
          ? obj.question.trim()
          : "Please provide the information or confirmation.";
      const options = Array.isArray(obj.options)
        ? obj.options
            .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
            .map((s) => s.trim())
        : undefined;
      const stepIndex =
        typeof obj.stepIndex === "number" && Number.isInteger(obj.stepIndex)
          ? obj.stepIndex
          : undefined;
      const stepTotal =
        typeof obj.stepTotal === "number" && Number.isInteger(obj.stepTotal)
          ? obj.stepTotal
          : undefined;
      const interactivePrompt: {
        question: string;
        options?: string[];
        stepIndex?: number;
        stepTotal?: number;
      } = { question, options };
      if (stepIndex != null) interactivePrompt.stepIndex = stepIndex;
      if (stepTotal != null) interactivePrompt.stepTotal = stepTotal;
      return { status: "waiting_for_input", interactivePrompt };
    }
  }
  const formatResp = useLast
    ? [...toolResults].reverse().find((r) => r.name === "format_response")
    : toolResults.find((r) => r.name === "format_response");
  const fmtRes = formatResp?.result;
  if (fmtRes && typeof fmtRes === "object" && fmtRes !== null) {
    const obj = fmtRes as {
      formatted?: boolean;
      summary?: string;
      needsInput?: string;
      options?: unknown[];
    };
    if (obj.formatted === true) {
      const hasOptions = Array.isArray(obj.options) && obj.options.length > 0;
      const hasNeedsInput = typeof obj.needsInput === "string" && obj.needsInput.trim().length > 0;
      if (hasOptions || hasNeedsInput) {
        const options = hasOptions
          ? (obj.options as unknown[])
              .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
              .map((s) => s.trim())
          : [];
        const question =
          [obj.summary, obj.needsInput].filter(Boolean).join("\n\n").trim() || "Choose an option:";
        return { status: "waiting_for_input", interactivePrompt: { question, options } };
      }
    }
  }
  return { status: "completed" };
}

/**
 * Normalize option count in display content so the text matches the actual number of options.
 * Replaces phrases like "four options", "4 options", "one of the X options" with the actual count.
 */
export function normalizeOptionCountInContent(content: string, actualCount: number): string {
  if (actualCount < 0 || !Number.isInteger(actualCount)) return content;
  const word = actualCount === 1 ? "option" : "options";
  let out = content;
  // "X option(s)" or "X options" where X is a digit
  out = out.replace(/\b\d+\s*options?\b/gi, () => `${actualCount} ${word}`);
  // "one of the X options" / "one of the four options"
  out = out.replace(/\bone of the \d+\s*options?\b/gi, () => `one of the ${actualCount} ${word}`);
  return out;
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

/** True when tool results include format_response with non-empty summary or needsInput. Used to skip heap synthetic ask_user injection when the agent already presented a questionnaire via format_response. */
export function hasFormatResponseWithContent(
  toolResults: { name: string; result?: unknown }[]
): boolean {
  const fr = toolResults.find((r) => r.name === "format_response");
  if (!fr?.result || typeof fr.result !== "object") return false;
  const obj = fr.result as { summary?: string; needsInput?: string };
  return Boolean(
    (typeof obj.summary === "string" && obj.summary.trim() !== "") ||
    (typeof obj.needsInput === "string" && obj.needsInput.trim() !== "")
  );
}

export type DerivedInteractivePrompt = { question: string; options: string[] };

/** Deterministic extraction: find "Next steps" / "pick one" / "choose one" and collect the next 2–4 bullet lines as options. Returns null if pattern does not match or options count not 2–4. Exported for tests. */
export function deriveInteractivePromptFromContentDeterministic(
  content: string
): DerivedInteractivePrompt | null {
  const trimmed = (content ?? "").trim();
  if (trimmed.length < 50) return null;
  const sectionMatch = trimmed.match(
    /\b(next steps?|pick one|choose one|choose an option)\s*[:\s]*/i
  );
  const question = sectionMatch ? sectionMatch[1].trim() : "Next steps";
  const afterSection = sectionMatch
    ? trimmed.slice(sectionMatch.index! + sectionMatch[0].length)
    : trimmed;
  const bulletRegex = /^\s*[-•*]\s+(.+)$/gm;
  const options: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = bulletRegex.exec(afterSection)) !== null && options.length < 4) {
    const label = m[1].trim();
    if (label.length >= 2 && label.length <= 80) options.push(label);
  }
  if (options.length < 2 || options.length > 4) return null;
  return { question, options };
}

/**
 * Derive interactivePrompt (question + options) from display content. Tries deterministic extraction first (Next steps + bullets); only calls LLM when that returns null.
 * Use when the current ask_user in toolResults is for a different question (e.g. Q1) than what the user reads (e.g. "Next steps").
 */
export async function deriveInteractivePromptFromContentWithLLM(
  displayContent: string,
  callLLM: (prompt: string) => Promise<string>
): Promise<DerivedInteractivePrompt | null> {
  const trimmed = (displayContent ?? "").trim();
  if (trimmed.length < 50) return null;
  const deterministic = deriveInteractivePromptFromContentDeterministic(trimmed);
  if (deterministic !== null) return deterministic;
  const prompt = `Given the assistant message below, output ONLY a JSON object with two keys: "question" (string, the single question the user should answer now, e.g. "Next steps") and "options" (array of 2–4 strings, the exact labels for clickable buttons the user can choose). Use the final choice list / Next steps if present. No other text.

Message:
${trimmed.slice(0, 6000)}

JSON object only:`;
  try {
    const out = await callLLM(prompt);
    const match = out.trim().match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as unknown;
    if (
      parsed == null ||
      typeof parsed !== "object" ||
      !("question" in parsed) ||
      !("options" in parsed)
    )
      return null;
    const question = String((parsed as { question: unknown }).question ?? "").trim();
    const options = Array.isArray((parsed as { options: unknown }).options)
      ? (parsed as { options: unknown[] }).options
          .filter((x): x is string => typeof x === "string")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    if (!question || options.length < 2 || options.length > 4) return null;
    return { question, options };
  } catch {
    return null;
  }
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
    ? (listAgents.result as { id?: string }[])
        .map((x) => x.id)
        .filter((id): id is string => typeof id === "string")
    : [];
  const workflowIds = Array.isArray(listWorkflows?.result)
    ? (listWorkflows.result as { id?: string }[])
        .map((x) => x.id)
        .filter((id): id is string => typeof id === "string")
    : [];
  const options =
    askUser?.result &&
    typeof askUser.result === "object" &&
    askUser.result !== null &&
    "options" in askUser.result
      ? Array.isArray((askUser.result as { options?: unknown }).options)
        ? ((askUser.result as { options: unknown[] }).options.filter(
            (o): o is string => typeof o === "string"
          ) as string[])
        : []
      : [];
  const firstOption = options[0]?.trim();
  if (!firstOption || (agentIds.length === 0 && workflowIds.length === 0)) return null;
  return { agentIds, workflowIds, firstOption };
}

export function userMessageMatchesFirstOption(userTrim: string, firstOption: string): boolean {
  return userTrim === firstOption || userTrim.toLowerCase() === firstOption.toLowerCase();
}

/** Build specialist outcome summary and append [Created agent id: ...] / [Created workflow id: ...] from tool results so next specialist receives exact UUIDs. */
export function buildSpecialistSummaryWithCreatedIds(
  content: string,
  toolResults: { name: string; result?: unknown }[]
): string {
  let summary =
    (content ?? "").trim().slice(0, 16000) || (toolResults.length > 0 ? "Done." : "No output.");
  for (const tr of toolResults) {
    if (
      tr.name === "create_agent" &&
      tr.result &&
      typeof tr.result === "object" &&
      "id" in tr.result &&
      typeof (tr.result as { id: string }).id === "string"
    ) {
      summary += `\n[Created agent id: ${(tr.result as { id: string }).id}]`;
    }
    if (
      tr.name === "create_workflow" &&
      tr.result &&
      typeof tr.result === "object" &&
      "id" in tr.result &&
      typeof (tr.result as { id: string }).id === "string"
    ) {
      summary += `\n[Created workflow id: ${(tr.result as { id: string }).id}]`;
    }
  }
  return summary;
}

/** Extract create_agent / create_workflow ids from tool results. */
export function getCreatedIdsFromToolResults(toolResults: { name: string; result?: unknown }[]): {
  agentId?: string;
  workflowId?: string;
} {
  const out: { agentId?: string; workflowId?: string } = {};
  for (const tr of toolResults) {
    if (
      tr.name === "create_agent" &&
      tr.result &&
      typeof tr.result === "object" &&
      "id" in tr.result &&
      typeof (tr.result as { id: string }).id === "string"
    ) {
      out.agentId = (tr.result as { id: string }).id;
    }
    if (
      tr.name === "create_workflow" &&
      tr.result &&
      typeof tr.result === "object" &&
      "id" in tr.result &&
      typeof (tr.result as { id: string }).id === "string"
    ) {
      out.workflowId = (tr.result as { id: string }).id;
    }
  }
  return out;
}

/** Merge workflowId/agentId from tool results into a plan's extractedContext so the next turn (e.g. "Run it now") has ids. */
export function mergeCreatedIdsIntoPlan<T extends { extractedContext?: Record<string, unknown> }>(
  plan: T,
  toolResults: { name: string; result?: unknown }[]
): T {
  const ids = getCreatedIdsFromToolResults(toolResults);
  if (!ids.agentId && !ids.workflowId) return plan;
  const extractedContext = {
    ...(plan.extractedContext ?? {}),
    ...(ids.workflowId != null && { workflowId: ids.workflowId }),
    ...(ids.agentId != null && { agentId: ids.agentId }),
  };
  return { ...plan, extractedContext };
}
