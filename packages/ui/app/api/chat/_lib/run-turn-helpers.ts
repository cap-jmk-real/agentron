/**
 * Helpers for chat run/turn: rephrase, summarize, system context, run response for chat.
 */

import { platform } from "node:os";
import { eq, asc } from "drizzle-orm";
import type { LLMTraceCall, LLMConfig } from "@agentron-studio/core";
import type { LLMMessage } from "@agentron-studio/runtime";
import { createDefaultLLMManager } from "@agentron-studio/runtime";
import { db, chatMessages, conversations } from "../../_lib/db";

/** Build system context so the assistant generates platform-appropriate shell commands. */
export function getSystemContext(): string {
  const p = platform();
  if (p === "win32") {
    return "System: Windows. Shell commands run via PowerShell — use where.exe to find executables (e.g. where.exe podman, where.exe docker). Paths use backslashes.";
  }
  if (p === "darwin") {
    return "System: macOS. Shell commands run via sh — use Unix commands (e.g. which, ls, docker, podman).";
  }
  if (p === "linux") {
    return "System: Linux. Shell commands run via sh — use Unix commands (e.g. which, ls, docker, podman).";
  }
  return `System: ${p}. Shell commands run via sh (Unix-style) unless Windows.`;
}

/** Build a chat-friendly message from a run's output and logs. Surfaces agent narrative, errors, and next steps. */
export function buildRunResponseForChat(
  run: { id: string; status: string; output?: unknown },
  logEntries: Array<{ level: string; message: string }>
): string {
  const lines: string[] = [];
  const out =
    run.output && typeof run.output === "object" && !Array.isArray(run.output)
      ? (run.output as Record<string, unknown>)
      : null;
  const runError = out?.error ?? (out?.errorDetails as { message?: string } | undefined)?.message;
  const agentOutput = out?.output;

  if (run.status === "failed" && runError) {
    lines.push(`**Run failed:** ${runError}`);
    if (
      out?.errorDetails &&
      typeof out.errorDetails === "object" &&
      (out.errorDetails as { stack?: string }).stack
    ) {
      lines.push("");
      lines.push("```");
      lines.push((out.errorDetails as { stack: string }).stack);
      lines.push("```");
    }
  } else if (run.status === "cancelled") {
    lines.push("Run was cancelled.");
  } else if (agentOutput !== undefined) {
    const text =
      typeof agentOutput === "string" ? agentOutput : JSON.stringify(agentOutput, null, 2);
    lines.push(text);
  }

  const stderrEntries = logEntries.filter((e) => e.level === "stderr" && e.message.trim());
  const uniqueStderr = [...new Set(stderrEntries.map((e) => e.message.trim()))].filter((m) =>
    /error|fail|invalid|improper/i.test(m)
  );
  if (uniqueStderr.length > 0) {
    lines.push("");
    lines.push("**Container/execution errors:**");
    for (const msg of uniqueStderr.slice(0, 5)) {
      lines.push(`- ${msg}`);
    }
  }

  if (run.status === "waiting_for_user") {
    lines.push("");
    lines.push("▶ **The agent is waiting for your input.** Reply above to continue.");
  }

  lines.push("");
  lines.push(`[View full run](/runs/${run.id})`);
  return lines.join("\n");
}

/** Apply common grammar/spacing fixes when the rephrase model echoes the user message. */
export function applyRephraseFixes(text: string): string {
  return text
    .replace(/\bThenI\b/gi, "Then I")
    .replace(/\bthenI\b/gi, "then I")
    .replace(/\blinkedin\b/gi, "LinkedIn")
    .replace(/\bsales navigator\b/gi, "Sales Navigator");
}

/** Max length for message to treat as unambiguous retry (skip rephrase LLM). */
export const REPHRASE_RETRY_MAX_LEN = 30;

/** Patterns for unambiguous retry/redo intent; only when message is very short. */
const REPHRASE_RETRY_PATTERN = /^\s*(retry|again|redo|same\s+again|try\s+again)\s*$/i;

/** First step: rephrase the user message into a clear prompt and detect if they want to retry the last message. Uses deterministic wants_retry for very short retry phrases to skip the rephrase LLM. */
export async function rephraseAndClassify(
  userMessage: string,
  manager: ReturnType<typeof createDefaultLLMManager>,
  llmConfig: {
    provider: string;
    model: string;
    endpoint?: string;
    apiKey?: string;
    apiKeyRef?: string;
    extra?: { apiKey?: string };
  },
  opts?: { onLlmCall?: (entry: LLMTraceCall) => void }
): Promise<{ rephrasedPrompt: string | undefined; wantsRetry: boolean }> {
  const trimmed = userMessage.trim().slice(0, 2000);
  if (!trimmed) return { rephrasedPrompt: undefined, wantsRetry: false };
  if (trimmed.length <= REPHRASE_RETRY_MAX_LEN && REPHRASE_RETRY_PATTERN.test(trimmed)) {
    return { rephrasedPrompt: undefined, wantsRetry: true };
  }
  const messages: LLMMessage[] = [
    {
      role: "system",
      content: `You rephrase the user's message into a clear version that captures their intent. You MUST fix every typo and grammar error in your output (e.g. "ThenI" -> "Then I", "linkedin" -> "LinkedIn", "fo" -> "for"). Your rephrased text must be different from the user's message where errors exist — do not copy the user's message unchanged. Use 1-3 sentences if needed.
CRITICAL: Preserve all IDs verbatim. Any UUID, hex id, or "id <value>" in the user message must be copied character-for-character — never abbreviate, shorten, or use ellipsis (e.g. never output "id 93f81c45-..." or "8394..."; output the full id).
Then say whether they are asking to RETRY or REDO their last message. Output exactly:
<rephrased>your corrected rephrased prompt here</rephrased>
<wants_retry>yes</wants_retry> or <wants_retry>no</wants_retry>`,
    },
    { role: "user", content: trimmed },
  ];
  try {
    const response = await manager.chat(llmConfig as LLMConfig, {
      messages,
      maxTokens: 280,
      temperature: 0.2,
    });
    opts?.onLlmCall?.({
      phase: "rephrase",
      messageCount: messages.length,
      lastUserContent: trimmed.slice(0, 500),
      requestMessages: messages.map((m) => ({
        role: m.role,
        content: (typeof m.content === "string" ? m.content : "").slice(0, 800),
      })),
      responseContent: (response.content ?? "").slice(0, 2000),
      responsePreview: (response.content ?? "").slice(0, 400),
      usage: response.usage,
    });
    const raw = response.content?.trim() ?? "";
    const wantsRetry = /<wants_retry>\s*yes\s*<\/wants_retry>/i.test(raw);
    const rephrasedMatch = raw.match(/<rephrased>\s*([\s\S]*?)<\/rephrased>/i);
    let rephrasedPrompt: string;
    if (rephrasedMatch && rephrasedMatch[1].trim()) {
      rephrasedPrompt = rephrasedMatch[1].trim().slice(0, 800);
    } else if (raw) {
      const withoutWantsRetry = raw.replace(/\s*<wants_retry>[\s\S]*$/i, "").trim();
      rephrasedPrompt = withoutWantsRetry.slice(0, 800) || trimmed;
    } else {
      rephrasedPrompt = trimmed;
    }
    if (rephrasedPrompt === trimmed || rephrasedPrompt.toLowerCase() === trimmed.toLowerCase()) {
      rephrasedPrompt = applyRephraseFixes(trimmed);
    }
    return { rephrasedPrompt, wantsRetry };
  } catch {
    return { rephrasedPrompt: undefined, wantsRetry: false };
  }
}

/** Max length for "short message" skip-rephrase (avoid rephrase for "ok", "yes", "3", etc.). */
export const SHORT_MESSAGE_SKIP_REPHRASE_LEN = 100;

/** Max chars for stdout/stderr in continueShellApproval effectiveMessage to keep context small. */
export const CONTINUE_SHELL_OUTPUT_MAX_LEN = 500;

export function buildContinueShellApprovalMessage(data: {
  command: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}): string {
  const trunc = (s: string) =>
    s.length <= CONTINUE_SHELL_OUTPUT_MAX_LEN ? s : s.slice(0, CONTINUE_SHELL_OUTPUT_MAX_LEN) + "…";
  const stdout = trunc((data.stdout ?? "").trim());
  const stderr = trunc((data.stderr ?? "").trim());
  const exitCode = data.exitCode ?? "";
  return `The user approved the shell command: \`${(data.command ?? "").trim()}\`. Result: exitCode=${exitCode}${stdout ? `, stdout: ${stdout}` : ""}${stderr ? `, stderr: ${stderr}` : ""}.`;
}

/** Whether to skip rephrase (synthetic messages, explicit flag, or short non-question) to save one LLM call. */
export function shouldSkipRephrase(content: string, payload?: { skipRephrase?: boolean }): boolean {
  if (payload?.skipRephrase === true) return true;
  const trimmed = content.trim();
  if (trimmed.startsWith("The user approved and ran:")) return true;
  if (trimmed.startsWith("Added ") && trimmed.includes("allowlist")) return true;
  if (
    trimmed.length > 0 &&
    trimmed.length < SHORT_MESSAGE_SKIP_REPHRASE_LEN &&
    !trimmed.endsWith("?")
  )
    return true;
  return false;
}

const TITLE_FALLBACK_MAX_LEN = 40;

/** Generate a short chat title from the first user message using the configured LLM. Falls back to truncated message if LLM fails or returns empty. */
export async function generateConversationTitle(
  firstMessage: string,
  manager: ReturnType<typeof createDefaultLLMManager>,
  llmConfig: {
    provider: string;
    model: string;
    endpoint?: string;
    apiKey?: string;
    apiKeyRef?: string;
    extra?: { apiKey?: string };
  }
): Promise<string | null> {
  const trimmed = firstMessage.trim();
  if (!trimmed) return null;
  const fallback =
    trimmed.slice(0, TITLE_FALLBACK_MAX_LEN).trim() +
    (trimmed.length > TITLE_FALLBACK_MAX_LEN ? "…" : "");
  try {
    const response = await manager.chat(llmConfig as LLMConfig, {
      messages: [
        {
          role: "system",
          content:
            "Generate a very short chat title (3–6 words) for the following user message. Reply with only the title, no quotes or punctuation.",
        },
        { role: "user", content: trimmed.slice(0, 400) },
      ],
      maxTokens: 40,
      temperature: 0.3,
    });
    const title =
      response.content
        ?.trim()
        .replace(/^["']|["']$/g, "")
        .slice(0, 80) || null;
    return title || fallback;
  } catch {
    return fallback;
  }
}

/** Generate and store a short summary for a conversation (fire-and-forget). */
export async function summarizeConversation(
  convId: string,
  manager: ReturnType<typeof createDefaultLLMManager>,
  llmConfig: {
    provider: string;
    model: string;
    endpoint?: string;
    apiKey?: string;
    apiKeyRef?: string;
    extra?: { apiKey?: string };
  }
): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, convId))
      .orderBy(asc(chatMessages.createdAt));
    const text = rows
      .map((r) => `${r.role}: ${r.content.slice(0, 300)}${r.content.length > 300 ? "…" : ""}`)
      .join("\n");
    if (!text.trim()) return;
    const response = await manager.chat(llmConfig as LLMConfig, {
      messages: [
        {
          role: "system",
          content:
            "Summarize this chat in 2–3 short sentences. Include: (1) what the user asked, (2) what the assistant did or produced (e.g. created agents/workflows, gave code, suggested changes) so the user can refer to 'the output' or 'what you said' later. No preamble.",
        },
        { role: "user", content: text.slice(0, 4000) },
      ],
      maxTokens: 150,
      temperature: 0.2,
    });
    const summary = response.content?.trim().slice(0, 500) || null;
    if (summary) {
      await db.update(conversations).set({ summary }).where(eq(conversations.id, convId)).run();
    }
  } catch {
    // ignore
  }
}

/** Compress long conversation history by summarizing older messages so context stays within limits while preserving what happened. */
export const DEFAULT_HISTORY_COMPRESS_AFTER = 24;
export const DEFAULT_HISTORY_KEEP_RECENT = 16;
/** Max completion tokens for chat assistant so long tool calls (e.g. execute_code with large commands) are not truncated. */
export const CHAT_ASSISTANT_MAX_TOKENS = 16384;

export async function summarizeHistoryChunk(
  messages: { role: string; content: string }[],
  manager: ReturnType<typeof createDefaultLLMManager>,
  llmConfig: {
    provider: string;
    model: string;
    endpoint?: string;
    apiKey?: string;
    apiKeyRef?: string;
    extra?: { apiKey?: string };
  }
): Promise<string> {
  if (messages.length === 0) return "";
  const text = messages
    .map((m) => `${m.role}: ${m.content.slice(0, 400)}${m.content.length > 400 ? "…" : ""}`)
    .join("\n");
  const response = await manager.chat(llmConfig as LLMConfig, {
    messages: [
      {
        role: "system",
        content:
          "Summarize this conversation segment in 3–5 short sentences. Include: what the user asked or said, what the assistant did (created/updated agents, workflows, tools; answered questions; asked for confirmation). Preserve decisions and IDs if mentioned (e.g. 'user chose OpenAI', 'workflow X was created'). No preamble.",
      },
      { role: "user", content: text.slice(0, 6000) },
    ],
    maxTokens: 300,
    temperature: 0.2,
  });
  return response.content?.trim().slice(0, 800) || "Earlier messages in this conversation.";
}
