"use client";

import React, { useState, useCallback } from "react";
import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { Copy, Check, ChevronDown, ChevronUp, ExternalLink, Terminal, ShieldPlus, Play } from "lucide-react";

/** Format reasoning text: split by "Task understanding:", "Approach:", "Step plan:" and render as sections with markdown. */
export function ReasoningContent({ text }: { text: string }) {
  const trimmed = text.trim();
  const hasSections = /(Task understanding|Approach|Step plan)\s*:/i.test(trimmed);
  const parts = hasSections ? trimmed.split(/(?=\s*(?:Task understanding|Approach|Step plan)\s*:)/i).filter((s) => s.trim().length > 0) : [];
  if (!hasSections || parts.length === 0) {
    return (
      <div className="chat-section-reasoning-formatted chat-reasoning-markdown">
        <ReactMarkdown remarkPlugins={[remarkBreaks, remarkGfm]} components={markdownComponents as unknown as Components}>
          {trimmed}
        </ReactMarkdown>
      </div>
    );
  }
  const items: { label: string; body: string }[] = [];
  for (const part of parts) {
    const m = part.trim().match(/^\s*(Task understanding|Approach|Step plan)\s*:\s*(.*)/is);
    if (m) {
      items.push({ label: m[1]!, body: (m[2] ?? "").trim() });
    } else {
      items.push({ label: "", body: part.trim() });
    }
  }
  return (
    <div className="chat-section-reasoning-formatted">
      {items.map((p, i) => (
        <div key={i} className="chat-section-reasoning-section">
          {p.label ? <h3 className="chat-section-reasoning-heading">{p.label}</h3> : null}
          <div className="chat-section-reasoning-body chat-reasoning-markdown">
            <ReactMarkdown remarkPlugins={[remarkBreaks, remarkGfm]} components={markdownComponents as unknown as Components}>
              {p.body}
            </ReactMarkdown>
          </div>
        </div>
      ))}
    </div>
  );
}

function CodeBlock({ content, lang, className }: { content: string; lang?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }, [content]);
  return (
    <div className={`chat-code-block ${className ?? ""}`}>
      <div className="chat-code-block-header">
        {lang && <span className="chat-code-block-lang">{lang}</span>}
        <button type="button" className="chat-code-block-copy" onClick={copy} title="Copy to clipboard">
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>
      <pre className="chat-code-block-pre">
        <code>{content}</code>
      </pre>
    </div>
  );
}

type Props = {
  content: string;
  /** When present (from format_response tool), render summary first then needsInput in a highlighted block */
  structuredContent?: { summary: string; needsInput?: string };
};

const markdownComponents = {
  pre({ children }: { children?: React.ReactNode }) {
    const codeEl = Array.isArray(children) ? children[0] : children;
    if (React.isValidElement(codeEl) && codeEl.type === "code") {
      const { className, children: codeChildren } = (codeEl.props ?? {}) as { className?: string; children?: unknown };
      const lang = className?.replace(/^language-/, "");
      return (
        <CodeBlock content={String(codeChildren ?? "").replace(/\n$/, "")} lang={lang || undefined} />
      );
    }
    return <pre>{children}</pre>;
  },
  code(props: { inline?: boolean; className?: string; children?: React.ReactNode; [k: string]: unknown }) {
    const { inline, children, ...rest } = props;
    if (inline) {
      return (
        <code className="chat-inline-code" {...rest}>
          {children}
        </code>
      );
    }
    return <>{children}</>;
  },
  p: ({ children }: { children?: React.ReactNode }) => <p className="chat-md-p">{children}</p>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="chat-md-ul">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="chat-md-ol">{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => <li className="chat-md-li">{children}</li>,
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="chat-md-strong">{children}</strong>,
  em: ({ children }: { children?: React.ReactNode }) => <em className="chat-md-em">{children}</em>,
  blockquote: ({ children }: { children?: React.ReactNode }) => <blockquote className="chat-md-blockquote">{children}</blockquote>,
  hr: () => <hr className="chat-md-hr" />,
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="chat-md-link">
      {children}
    </a>
  ),
  h1: ({ children }: { children?: React.ReactNode }) => <h1 className="chat-md-h1">{children}</h1>,
  h2: ({ children }: { children?: React.ReactNode }) => <h2 className="chat-md-h2">{children}</h2>,
  h3: ({ children }: { children?: React.ReactNode }) => <h3 className="chat-md-h3">{children}</h3>,
  h4: ({ children }: { children?: React.ReactNode }) => <h4 className="chat-md-h4">{children}</h4>,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="chat-md-table-wrap">
      <table className="chat-md-table">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => <thead className="chat-md-thead">{children}</thead>,
  tbody: ({ children }: { children?: React.ReactNode }) => <tbody className="chat-md-tbody">{children}</tbody>,
  tr: ({ children }: { children?: React.ReactNode }) => <tr className="chat-md-tr">{children}</tr>,
  th: ({ children }: { children?: React.ReactNode }) => <th className="chat-md-th">{children}</th>,
  td: ({ children }: { children?: React.ReactNode }) => <td className="chat-md-td">{children}</td>,
};

export function ChatMessageContent({ content, structuredContent }: Props) {
  if (structuredContent?.summary) {
    return (
      <div className="chat-msg-content chat-msg-content-markdown">
        <ReactMarkdown remarkPlugins={[remarkBreaks, remarkGfm]} components={markdownComponents as unknown as Components}>
          {structuredContent.summary}
        </ReactMarkdown>
        {structuredContent.needsInput && (
          <div className="chat-needs-input">
            <span className="chat-needs-input-label">Input needed</span>
            <ReactMarkdown remarkPlugins={[remarkBreaks, remarkGfm]} components={markdownComponents as unknown as Components}>
              {structuredContent.needsInput}
            </ReactMarkdown>
          </div>
        )}
      </div>
    );
  }
  if (!content?.trim()) return null;
  const shellOutput = parseShellOutputMessage(content);
  if (shellOutput) {
    return (
      <div className="chat-msg-content">
        <ShellOutputBlock
          command={shellOutput.command}
          stdout={shellOutput.stdout}
          stderr={shellOutput.stderr}
          exitCode={shellOutput.exitCode}
        />
      </div>
    );
  }
  return (
    <div className="chat-msg-content chat-msg-content-markdown">
      <ReactMarkdown remarkPlugins={[remarkBreaks, remarkGfm]} components={markdownComponents as unknown as Components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

export type ToolResult = { name: string; args: Record<string, unknown>; result: unknown };

/** Parse numbered options from text, e.g. "(1) Option A (2) Option B", "1) First 2) Second", or "1. First 2. Second". */
function parseSuggestedOptionsFromText(text: string): { value: string; label: string }[] {
  if (!text?.trim()) return [];
  const options: { value: string; label: string }[] = [];
  const parenRegex = /\(\s*(\d+)\s*\)\s*([^(\n]+?)(?=\s*\(\s*\d+\s*\)|$)/g;
  let m: RegExpExecArray | null;
  while ((m = parenRegex.exec(text)) !== null) {
    const label = m[2].trim().replace(/\s+/g, " ");
    if (label) options.push({ value: m[1], label });
  }
  if (options.length > 0) return options;
  // "1) Option text\n2) Option text" (digit + closing paren, common in assistant replies)
  const digitParenRegex = /(\d+)\)\s*([\s\S]+?)(?=\n\s*\d+\)|$)/g;
  while ((m = digitParenRegex.exec(text)) !== null) {
    let raw = m[2].trim();
    // Drop trailing "Please reply..." / "Tell me what to change" line so it isn't part of the last option label
    raw = raw.replace(/\n\n\s*(Please reply|reply with|tell me what to change)[\s\S]*$/i, "").trim();
    const label = raw.replace(/\s+/g, " ");
    if (label) options.push({ value: m[1], label });
  }
  if (options.length > 0) return options;
  const dotRegex = /(\d+)\.\s*([^\n]+?)(?=\s*\d+\.|$)/g;
  while ((m = dotRegex.exec(text)) !== null) {
    const label = m[2].trim().replace(/\s+/g, " ");
    if (label) options.push({ value: m[1], label });
  }
  return options;
}

/** Normalize toolCalls from API (may have `arguments`) to ToolResult shape with `args`. */
export function normalizeToolResults(
  raw: unknown
): { name: string; args: Record<string, unknown>; result: unknown }[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw.map((r) => {
    const item = r as { name?: string; args?: Record<string, unknown>; arguments?: Record<string, unknown>; result?: unknown };
    const name = typeof item.name === "string" ? item.name : "";
    const args = item.args ?? item.arguments ?? {};
    const result = item.result;
    return { name, args: typeof args === "object" && args !== null ? args : {}, result };
  }).filter((r) => r.name);
}

/** Get clickable options from ask_user: uses result.options when present, else parses question text. */
export function getSuggestedOptions(
  askUserResult: { result?: unknown } | undefined,
  questionOrDisplayText: string
): { value: string; label: string }[] {
  const res = askUserResult?.result;
  if (res && typeof res === "object" && res !== null && "options" in res) {
    const opts = (res as { options?: unknown }).options;
    if (Array.isArray(opts) && opts.length > 0) {
      return opts
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((s) => ({ value: s.trim(), label: s.trim() }));
    }
  }
  return parseSuggestedOptionsFromText(questionOrDisplayText || "");
}

/** Get clickable options from tool results (ask_user, ask_credentials, or format_response). Use when interactivePrompt.options may be missing (e.g. reload). */
export function getSuggestedOptionsFromToolResults(
  toolResults: { name: string; result?: unknown }[] | undefined,
  fallbackDisplayText: string
): { value: string; label: string }[] {
  if (!Array.isArray(toolResults)) return parseSuggestedOptionsFromText(fallbackDisplayText);
  const withOptions = toolResults.find(
    (r) => r.name === "ask_user" || r.name === "ask_credentials" || r.name === "format_response"
  );
  const opts = getSuggestedOptions(withOptions, fallbackDisplayText);
  return opts.length > 0 ? opts : parseSuggestedOptionsFromText(fallbackDisplayText);
}

/** True when the message has tool results that indicate a successful turn (e.g. create_agent, get_agent). Don't show "An error occurred" for these. */
export function messageHasSuccessfulToolResults(
  toolResults: { name: string; result?: unknown }[] | undefined
): boolean {
  if (!Array.isArray(toolResults) || toolResults.length === 0) return false;
  const successTools = [
    "create_agent", "update_agent", "get_agent",
    "create_workflow", "update_workflow", "get_workflow",
    "format_response", "list_tools", "list_agents", "list_llm_providers",
    "execute_workflow", "execute_agent",
  ];
  return toolResults.some((r) => successTools.includes(r.name));
}

/** True when message content looks like a successful response (summary, created, next steps). Don't show "An error occurred" for these. */
export function messageContentIndicatesSuccess(content: string | undefined): boolean {
  if (!content || typeof content !== "string") return false;
  const t = content.trim();
  if (t.length < 20) return false;
  const lower = t.toLowerCase();
  const successPhrases = ["created", "summary", "i have created", "what would you like", "would you like me to", "run the agent", "run it now", "id:", "container echo"];
  return successPhrases.some((p) => lower.includes(p));
}

/** True when message has ask_user/ask_credentials/format_response waiting for input (lenient: checks waitingForUser, options, or format_response with needsInput). */
export function hasAskUserWaitingForInput(
  toolResults: { name: string; result?: unknown }[] | undefined
): boolean {
  if (!Array.isArray(toolResults)) return false;
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
      const obj = res as { formatted?: boolean; options?: unknown[]; needsInput?: string };
      if (obj.formatted !== true) return false;
      if (Array.isArray(obj.options) && obj.options.length > 0) return true;
      if (typeof obj.needsInput === "string" && obj.needsInput.trim()) return true;
      return false;
    }
    return false;
  });
}

/** Shared message display state for modal and section. */
export function getMessageDisplayState(
  msg: { role: string; content: string; toolResults?: { name: string; result?: unknown }[]; status?: string; interactivePrompt?: { question: string; options?: string[] } },
  options: { isLast: boolean; loading: boolean }
) {
  const list = msg.toolResults ?? [];
  const parsedOptionsFromContent =
    msg.role === "assistant" ? parseSuggestedOptionsFromText(msg.content || "") : [];
  const contentSuggestsChoice = /pick one|choose one|please reply|reply with|what would you like|what you would like|option \d|^\s*1\)/im.test(msg.content || "");
  const hasAskUserWaiting =
    msg.status === "waiting_for_input" ||
    msg.interactivePrompt != null ||
    hasAskUserWaitingForInput(list) ||
    (parsedOptionsFromContent.length >= 2 && contentSuggestsChoice);
  // #region agent log
  if (msg.role === "assistant" && (list.length > 0 || (msg.content && /choose|option|please pick/i.test(msg.content)))) {
    fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: "chat-message-content.tsx:getMessageDisplayState", message: "Inline options detection", data: { hasAskUserWaiting, status: msg.status, hasInteractivePrompt: !!msg.interactivePrompt, interactivePromptOptions: msg.interactivePrompt?.options, toolNames: list.map((r) => r.name), hasAskUserFromToolResults: hasAskUserWaitingForInput(list), contentPreview: msg.content?.slice(0, 200) }, timestamp: Date.now(), hypothesisId: "H1" }) }).catch(() => {});
  }
  // #endregion
  const displayContent = msg.role === "assistant"
    ? (hasAskUserWaiting && msg.content.startsWith("Error: ")
      ? (getAssistantMessageDisplayContent("", list) || msg.content)
      : getAssistantMessageDisplayContent(msg.content, list))
    : msg.content;
  const formatResp = list.find((r) => r.name === "format_response");
  const fmtRes = formatResp?.result as { formatted?: boolean; summary?: string; needsInput?: string } | undefined;
  const hasStructuredContent = !!(fmtRes?.formatted && typeof fmtRes.summary === "string" && fmtRes.summary.trim());
  const structuredContent = hasStructuredContent && fmtRes?.summary
    ? { summary: fmtRes.summary.trim(), needsInput: typeof fmtRes.needsInput === "string" ? fmtRes.needsInput.trim() : undefined }
    : undefined;
  const hasFinalResponseContent = options.isLast && msg.role === "assistant" && !options.loading && (displayContent.trim() !== "" || !!hasStructuredContent);
  const todos = (msg as { todos?: unknown[] }).todos;
  const isEmptyPlaceholder = msg.role === "assistant" && options.loading && options.isLast
    && displayContent.trim() === ""
    && list.filter((r) => r.name !== "ask_user" && r.name !== "ask_credentials").length === 0
    && !msg.content.startsWith("Error: ")
    && (todos?.length ?? 0) === 0;
  return { displayContent, structuredContent, hasAskUserWaiting, hasFinalResponseContent, isEmptyPlaceholder };
}

/** Status string for loading indicator (modal and section). */
export function getLoadingStatus(
  msg: {
    traceSteps?: { phase: string; label?: string }[];
    todos?: string[];
    completedStepIndices?: number[];
    executingStepIndex?: number;
    executingToolName?: string;
    executingSubStepLabel?: string;
  }
): string {
  const lastTrace = (msg.traceSteps?.length ?? 0) > 0 ? msg.traceSteps![msg.traceSteps!.length - 1] : undefined;
  const isCallingLlm = lastTrace?.phase === "llm_request";
  if (isCallingLlm) return "Calling LLM…";
  const total = msg.todos?.length ?? 0;
  const allDone = total > 0 && (msg.completedStepIndices?.length ?? 0) === total;
  if (allDone) return "Completing…";
  const toolName = msg.executingToolName;
  if (toolName) {
    const subStep = msg.executingSubStepLabel;
    const toolLabel = toolName === "execute_workflow" ? "workflow" : toolName;
    return subStep ? `${subStep} (${toolLabel})…` : toolName === "execute_workflow" ? "Running workflow…" : `Running ${toolName}…`;
  }
  const stepIndex = msg.executingStepIndex;
  const todos = msg.todos ?? [];
  if (stepIndex !== undefined && total > 0 && todos[stepIndex] != null) {
    return total > 1 ? `Step ${stepIndex + 1} of ${total}: ${todos[stepIndex]}` : String(todos[stepIndex]);
  }
  if ((msg.traceSteps?.length ?? 0) > 0) {
    return msg.traceSteps![msg.traceSteps!.length - 1].label ?? msg.traceSteps![msg.traceSteps!.length - 1].phase ?? "Thinking…";
  }
  if (todos.length > 0 || (msg as { reasoning?: string }).reasoning != null) return "Planning…";
  return "Thinking…";
}

/** Returns message content, using ask_user question only when stored content is empty (avoids duplicating the question). */
export function getAssistantMessageDisplayContent(
  content: string,
  toolResults?: { name: string; result?: unknown }[]
): string {
  const base = (content ?? "").trim();
  if (base) return base;
  const question = getAskUserQuestionFromToolResults(toolResults);
  return question ?? base;
}

function getAskUserQuestionFromToolResults(
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

/** Extract run, workflow, and agent IDs from a tool result for quick links. */
function extractResourceLinks(
  toolName: string,
  result: unknown
): { runs: { id: string; label: string }[]; workflows: { id: string; name?: string }[]; agents: { id: string; name?: string }[] } {
  const runs: { id: string; label: string }[] = [];
  const workflows: { id: string; name?: string }[] = [];
  const agents: { id: string; name?: string }[] = [];
  if (result == null || typeof result !== "object") return { runs, workflows, agents };
  const obj = result as Record<string, unknown>;

  if (toolName === "execute_workflow" || toolName === "execute_agent") {
    const id = typeof obj.id === "string" ? obj.id : undefined;
    if (id) runs.push({ id, label: "View run" });
  }
  if (toolName === "create_workflow" || toolName === "update_workflow" || toolName === "get_workflow") {
    const id = typeof obj.id === "string" ? obj.id : undefined;
    const name = typeof obj.name === "string" ? obj.name : undefined;
    if (id) workflows.push({ id, name: name || undefined });
  }
  if (toolName === "create_agent" || toolName === "update_agent" || toolName === "get_agent") {
    const id = typeof obj.id === "string" ? obj.id : undefined;
    const name = typeof obj.name === "string" ? obj.name : undefined;
    if (id) agents.push({ id, name: name || undefined });
  }
  const wfList = Array.isArray(obj) && (toolName === "list_workflows" || toolName === "list_workflow")
    ? obj
    : obj.workflows;
  if (Array.isArray(wfList)) {
    for (const item of wfList) {
      if (item && typeof item === "object" && typeof (item as { id?: string }).id === "string") {
        const row = item as { id: string; name?: string };
        if (!workflows.some((w) => w.id === row.id)) workflows.push({ id: row.id, name: typeof row.name === "string" ? row.name : undefined });
      }
    }
  }
  const agList = Array.isArray(obj) && (toolName === "list_agents" || toolName === "list_agent")
    ? obj
    : obj.agents;
  if (Array.isArray(agList)) {
    for (const item of agList) {
      if (item && typeof item === "object" && typeof (item as { id?: string }).id === "string") {
        const row = item as { id: string; name?: string };
        if (!agents.some((a) => a.id === row.id)) agents.push({ id: row.id, name: typeof row.name === "string" ? row.name : undefined });
      }
    }
  }
  return { runs, workflows, agents };
}

/** Aggregate runs, workflows, and agents from all tool results in a message (deduped by id). */
export function aggregateResourceLinksFromResults(
  results: { name: string; result?: unknown }[]
): { runs: { id: string; label: string }[]; workflows: { id: string; name?: string }[]; agents: { id: string; name?: string }[] } {
  const runs: { id: string; label: string }[] = [];
  const workflows: { id: string; name?: string }[] = [];
  const agents: { id: string; name?: string }[] = [];
  const seenRun = new Set<string>();
  const seenWf = new Set<string>();
  const seenAg = new Set<string>();
  if (!Array.isArray(results)) return { runs, workflows, agents };
  for (const r of results) {
    const { runs: rRuns, workflows: rWf, agents: rAg } = extractResourceLinks(r.name, r.result);
    for (const x of rRuns) {
      if (!seenRun.has(x.id)) {
        seenRun.add(x.id);
        runs.push(x);
      }
    }
    for (const x of rWf) {
      if (!seenWf.has(x.id)) {
        seenWf.add(x.id);
        workflows.push(x);
      }
    }
    for (const x of rAg) {
      if (!seenAg.has(x.id)) {
        seenAg.add(x.id);
        agents.push(x);
      }
    }
  }
  return { runs, workflows, agents };
}

/** Standalone link list for runs/workflows/agents from this message's tool results. Render outside the tool results element. */
export function ChatMessageResourceLinks({ results }: { results: { name: string; result?: unknown }[] }) {
  const links = aggregateResourceLinksFromResults(results);
  const hasAny =
    links.runs.length > 0 || links.workflows.length > 0 || links.agents.length > 0;
  if (!hasAny) return null;
  return (
    <div className="chat-message-resource-links" aria-label="Resources from this message">
      <div className="chat-message-resource-links-inner">
        {links.runs.length > 0 && (
          <div className="chat-message-resource-links-group">
            <div className="chat-message-resource-links-label">Runs</div>
            {links.runs.map((r) => (
              <Link key={r.id} href={`/runs/${r.id}`} className="chat-message-resource-link">
                {r.label} <ExternalLink size={11} />
              </Link>
            ))}
          </div>
        )}
        {links.workflows.length > 0 && (
          <div className="chat-message-resource-links-group">
            <div className="chat-message-resource-links-label">Workflows</div>
            {links.workflows.map((w) => (
              <Link key={w.id} href={`/workflows/${w.id}`} className="chat-message-resource-link">
                {w.name ?? w.id} <ExternalLink size={11} />
              </Link>
            ))}
          </div>
        )}
        {links.agents.length > 0 && (
          <div className="chat-message-resource-links-group">
            <div className="chat-message-resource-links-label">Agents</div>
            {links.agents.map((a) => (
              <Link key={a.id} href={`/agents/${a.id}`} className="chat-message-resource-link">
                {a.name ?? a.id} <ExternalLink size={11} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function getToolResultDisplayText(result: unknown): string {
  if (result === null || result === undefined) return "done";
  if (typeof result === "object" && result !== null) {
    const obj = result as Record<string, unknown>;
    // Special-case ask_user and ask_credentials so the chip shows the actual question instead of a generic "done".
    if ("waitingForUser" in obj && (obj as { waitingForUser?: boolean }).waitingForUser === true && typeof obj.question === "string" && obj.question.trim()) {
      return obj.question.trim();
    }
    if ("credentialRequest" in obj && (obj as { credentialRequest?: boolean }).credentialRequest === true && typeof obj.question === "string" && obj.question.trim()) {
      return obj.question.trim();
    }
    if ("message" in obj) {
      return String(obj.message);
    }
  }
  if (typeof result === "string") return result;
  return "done";
}

function getToolResultCopyText(result: unknown): string {
  const display = getToolResultDisplayText(result);
  if (display !== "done" || (typeof result === "object" && result !== null)) return display;
  return "done";
}

/** Parse user message from shell command approval to extract command, stdout, stderr, exitCode. */
function parseShellOutputMessage(content: string): { command: string; stdout: string; stderr: string; exitCode?: number } | null {
  const m = content.match(/The user approved and ran: `([^`]+)`/);
  if (!m) return null;
  const command = m[1] ?? "";
  let stdout = "";
  let stderr = "";
  let exitCode: number | undefined;
  const stdoutMatch = content.match(/\*\*Stdout:\*\*\s*```\s*\n([\s\S]*?)\n```/);
  if (stdoutMatch) stdout = (stdoutMatch[1] ?? "").trimEnd();
  const stderrMatch = content.match(/\*\*Stderr:\*\*\s*```\s*\n([\s\S]*?)\n```/);
  if (stderrMatch) stderr = (stderrMatch[1] ?? "").trimEnd();
  const exitMatch = content.match(/_Exit code: (\d+)_/);
  if (exitMatch) exitCode = parseInt(exitMatch[1] ?? "0", 10);
  return { command, stdout, stderr, exitCode };
}

/** Renders executed shell command output in a terminal-style block (Cursor-like). */
export function ShellOutputBlock({
  command,
  stdout,
  stderr,
  exitCode,
}: {
  command: string;
  stdout: string;
  stderr: string;
  exitCode?: number;
}) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    const text = [stdout, stderr].filter(Boolean).join("\n");
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }, [stdout, stderr]);
  const hasOutput = stdout || stderr;
  return (
    <div className="chat-shell-output-block" role="group" aria-label="Shell output">
      <div className="chat-shell-output-header">
        <Terminal size={14} />
        <span className="chat-shell-output-command">{command}</span>
        {exitCode !== undefined && exitCode !== 0 && (
          <span className="chat-shell-output-exit">exit {exitCode}</span>
        )}
        {hasOutput && (
          <button
            type="button"
            className="chat-shell-output-copy"
            onClick={copy}
            title="Copy output"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        )}
      </div>
      {hasOutput ? (
        <pre className="chat-shell-output-pre">
          {stdout ? <code>{stdout}</code> : null}
          {stdout && stderr ? "\n" : null}
          {stderr ? <code className="chat-shell-output-stderr">{stderr}</code> : null}
        </pre>
      ) : (
        <pre className="chat-shell-output-pre chat-shell-output-empty">
          <code>(no output)</code>
        </pre>
      )}
    </div>
  );
}

/** Renders a shell command that needs user approval, with Add to allowlist and Approve & Run buttons. */
export function ShellCommandBlock({
  command,
  onAddToAllowlist,
  onApprove,
  disabled,
}: {
  command: string;
  onAddToAllowlist?: () => void;
  onApprove?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="chat-shell-command-block" role="group" aria-label="Shell command pending approval">
      <div className="chat-shell-command-label">
        <Terminal size={14} />
        <span>Command</span>
      </div>
      <pre className="chat-shell-command-pre">
        <code>{command}</code>
      </pre>
      <div className="chat-shell-command-actions">
        {onAddToAllowlist && (
          <button
            type="button"
            className="chat-shell-command-btn chat-shell-command-btn-allowlist"
            onClick={onAddToAllowlist}
            disabled={disabled}
            title="Add to allowlist (Settings → Shell commands)"
          >
            <ShieldPlus size={14} />
            Add to allowlist
          </button>
        )}
        {onApprove && (
          <button
            type="button"
            className="chat-shell-command-btn chat-shell-command-btn-approve"
            onClick={onApprove}
            disabled={disabled}
            title="Run this command"
          >
            <Play size={14} />
            Approve & Run
          </button>
        )}
      </div>
    </div>
  );
}

export function ChatToolResults({
  results,
  onShellCommandApprove,
  onShellCommandAddToAllowlist,
  shellCommandLoading = false,
}: {
  results: ToolResult[];
  onShellCommandApprove?: (command: string) => void;
  onShellCommandAddToAllowlist?: (command: string) => void;
  shellCommandLoading?: boolean;
}) {
  const [copiedAll, setCopiedAll] = useState(false);
  const copyAll = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const text = results
        .map((r) => `${r.name}: ${getToolResultCopyText(r.result)}`)
        .join("\n");
      try {
        await navigator.clipboard.writeText(text);
        setCopiedAll(true);
        setTimeout(() => setCopiedAll(false), 1500);
      } catch {}
    },
    [results]
  );

  const pendingShellCommands: { index: number; command: string }[] = [];
  const executedShellCommands: { command: string; stdout: string; stderr: string; exitCode?: number }[] = [];
  const otherResults: ToolResult[] = [];
  results.forEach((tr, i) => {
    if (tr.name === "run_shell_command" && tr.result && typeof tr.result === "object") {
      const res = tr.result as { needsApproval?: boolean; command?: string; stdout?: string; stderr?: string; exitCode?: number };
      const cmd = (typeof res.command === "string" ? res.command : typeof tr.args?.command === "string" ? tr.args.command : "").trim();
      if (res.needsApproval && cmd) {
        pendingShellCommands.push({ index: i, command: cmd });
        return;
      }
      if (cmd && (res.stdout !== undefined || res.stderr !== undefined || res.exitCode !== undefined)) {
        executedShellCommands.push({
          command: cmd,
          stdout: (res.stdout ?? "").trim(),
          stderr: (res.stderr ?? "").trim(),
          exitCode: res.exitCode,
        });
        return;
      }
    }
    otherResults.push(tr);
  });

  const hasShellBlocks = pendingShellCommands.length > 0 || executedShellCommands.length > 0;

  return (
    <>
      {hasShellBlocks && (
        <div className="chat-shell-commands-pending">
          {pendingShellCommands.map(({ index, command }) => (
            <ShellCommandBlock
              key={`pending-${index}`}
              command={command}
              onAddToAllowlist={
                onShellCommandAddToAllowlist ? () => onShellCommandAddToAllowlist(command) : undefined
              }
              onApprove={onShellCommandApprove ? () => onShellCommandApprove(command) : undefined}
              disabled={shellCommandLoading}
            />
          ))}
          {executedShellCommands.map((exec, i) => (
            <ShellOutputBlock
              key={`executed-${i}`}
              command={exec.command}
              stdout={exec.stdout}
              stderr={exec.stderr}
              exitCode={exec.exitCode}
            />
          ))}
        </div>
      )}
      {otherResults.length > 0 && (
        <details className="chat-tool-results">
          <summary className="chat-tool-results-summary">
            <span className="chat-tool-results-title">Tool results ({otherResults.length})</span>
            <button
              type="button"
              className="chat-tool-results-copy-all"
              onClick={copyAll}
              title="Copy all as text"
            >
              {copiedAll ? <Check size={12} /> : <Copy size={12} />}
              {copiedAll ? " Copied" : " Copy all"}
            </button>
          </summary>
          <div className="chat-tool-results-list">
            {otherResults.map((tr, i) => (
              <ToolResultChip key={i} name={tr.name} args={tr.args} result={tr.result} />
            ))}
          </div>
        </details>
      )}
    </>
  );
}

type TrailStep = { order: number; nodeId: string; agentName: string; input?: unknown; output?: unknown; error?: string };

/** Extract shell/console log from trail steps (stdout, stderr from tools). */
function buildShellLogFromTrail(trail: TrailStep[]): string {
  const lines: string[] = [];
  const sorted = [...trail].sort((a, b) => a.order - b.order);
  for (const step of sorted) {
    let o: Record<string, unknown> | null = null;
    const raw = step.output;
    if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
      o = raw as Record<string, unknown>;
    } else if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) o = parsed as Record<string, unknown>;
      } catch {
        /* not JSON */
      }
    }
    const stdout = o && typeof o.stdout === "string" ? o.stdout : undefined;
    const stderr = o && typeof o.stderr === "string" ? o.stderr : undefined;
    const err = o && typeof o.error === "string" ? o.error : undefined;
    const exitCode = o && o.exitCode !== undefined ? String(o.exitCode) : undefined;
    const hasOutput = stdout || stderr || err || (exitCode !== undefined && exitCode !== "0") || !!step.error;
    const hasStringOutput = !hasOutput && typeof raw === "string" && (raw as string).trim() !== "";
    if (hasOutput || hasStringOutput) {
      if (lines.length) lines.push("");
      lines.push(`# ${step.agentName} (step ${step.order + 1})`);
      if (stdout) { lines.push("--- stdout ---"); lines.push(stdout); }
      if (stderr) { lines.push("--- stderr ---"); lines.push(stderr); }
      if (err) { lines.push("--- error ---"); lines.push(err); }
      if (exitCode !== undefined && exitCode !== "0") lines.push(`--- exit code: ${exitCode} ---`);
      if (step.error) { lines.push("--- step error ---"); lines.push(step.error); }
      if (hasStringOutput) { lines.push("--- output ---"); lines.push(raw as string); }
    }
  }
  return lines.join("\n");
}

const linkRowStyle = {
  display: "flex",
  flexWrap: "wrap" as const,
  alignItems: "center",
  gap: "0.5rem 0.75rem",
  marginTop: 6,
  paddingTop: 6,
  borderTop: "1px solid var(--border-subtle, rgba(128,128,128,0.2))",
  fontSize: "0.8rem",
};

function ToolResultChip({ name, args, result }: { name: string; args: Record<string, unknown>; result: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const [showConsole, setShowConsole] = useState(false);
  const [copied, setCopied] = useState(false);
  const displayText = getToolResultDisplayText(result);
  const isObject = typeof result === "object" && result !== null;
  const jsonStr = isObject ? JSON.stringify(result, null, 2) : String(result ?? "");
  const copyText = getToolResultCopyText(result);
  const resourceLinks = extractResourceLinks(name, result);
  const hasResourceLinks =
    resourceLinks.runs.length > 0 ||
    resourceLinks.workflows.length > 0 ||
    resourceLinks.agents.length > 0;

  const isExecuteWorkflow = name === "execute_workflow" && isObject;
  const runId = isExecuteWorkflow && typeof (result as { id?: string }).id === "string" ? (result as { id: string }).id : undefined;
  const runOutput = isExecuteWorkflow ? (result as { output?: { trail?: TrailStep[] } }).output : undefined;
  const trail = runOutput && typeof runOutput === "object" && Array.isArray((runOutput as { trail?: TrailStep[] }).trail) ? (runOutput as { trail: TrailStep[] }).trail : [];
  const shellLog = trail.length > 0 ? buildShellLogFromTrail(trail) : "";
  const hasConsoleOutput = shellLog.trim() !== "";

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }, [copyText]);

  return (
    <div className="chat-tool-chip-wrap">
      <div className="chat-tool-chip">
        <button
          type="button"
          className="chat-tool-chip-expand"
          onClick={() => isObject && setExpanded((e) => !e)}
          title={isObject ? "Expand / collapse JSON" : undefined}
        >
          <span className="chat-tool-chip-name">{name}</span>
          <span className="chat-tool-chip-status">{displayText}</span>
          {isObject && (expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
        </button>
        <button
          type="button"
          className="chat-tool-chip-copy"
          onClick={copy}
          title="Copy result text"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
        </button>
      </div>
      {hasResourceLinks && (
        <div className="chat-tool-chip-links" style={linkRowStyle}>
          {resourceLinks.runs.map((r) => (
            <Link
              key={r.id}
              href={`/runs/${r.id}`}
              className="chat-tool-chip-link"
              style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--primary)", textDecoration: "none" }}
            >
              {r.label} <ExternalLink size={11} />
            </Link>
          ))}
          {resourceLinks.workflows.map((w) => (
            <Link
              key={w.id}
              href={`/workflows/${w.id}`}
              className="chat-tool-chip-link"
              style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--primary)", textDecoration: "none" }}
            >
              Workflow{w.name ? `: ${w.name}` : ""} <ExternalLink size={11} />
            </Link>
          ))}
          {resourceLinks.agents.map((a) => (
            <Link
              key={a.id}
              href={`/agents/${a.id}`}
              className="chat-tool-chip-link"
              style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--primary)", textDecoration: "none" }}
            >
              Agent{a.name ? `: ${a.name}` : ""} <ExternalLink size={11} />
            </Link>
          ))}
        </div>
      )}
      {expanded && isObject && (
        <>
          {isExecuteWorkflow && runId && (
            <div className="chat-tool-chip-run-link" style={{ marginTop: 8, marginBottom: hasConsoleOutput ? 8 : 0 }}>
              <Link
                href={`/runs/${runId}`}
                className="chat-tool-chip-view-run"
                style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.875rem", color: "var(--primary)", textDecoration: "none" }}
              >
                <ExternalLink size={14} />
                View run
              </Link>
              {hasConsoleOutput && (
                <button
                  type="button"
                  onClick={() => setShowConsole((c) => !c)}
                  style={{ marginLeft: 12, display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.875rem", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}
                >
                  <Terminal size={14} />
                  {showConsole ? "Hide console" : "Show console output"}
                </button>
              )}
            </div>
          )}
          {isExecuteWorkflow && hasConsoleOutput && showConsole && (
            <div className="chat-tool-chip-console" style={{ marginBottom: 8 }}>
              <CodeBlock content={shellLog} lang="text" className="chat-tool-chip-code" />
            </div>
          )}
          <CodeBlock content={jsonStr} lang="json" className="chat-tool-chip-code" />
        </>
      )}
    </div>
  );
}
