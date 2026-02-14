"use client";

import React, { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Check, ChevronDown, ChevronUp } from "lucide-react";

/** Format reasoning text: split by "Task understanding:", "Approach:", "Step plan:" and render as sections. */
export function ReasoningContent({ text }: { text: string }) {
  const trimmed = text.trim();
  const hasSections = /(Task understanding|Approach|Step plan)\s*:/i.test(trimmed);
  const parts = hasSections ? trimmed.split(/(?=\s*(?:Task understanding|Approach|Step plan)\s*:)/i).filter((s) => s.trim().length > 0) : [];
  if (!hasSections || parts.length === 0) {
    return <p className="chat-section-plan-text" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{trimmed}</p>;
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
          {p.label ? <strong className="chat-section-reasoning-heading">{p.label}:</strong> : null}
          <div className="chat-section-reasoning-body" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{p.body}</div>
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
};

export function ChatMessageContent({ content }: Props) {
  if (!content?.trim()) {
    return <div className="chat-msg-content" />;
  }
  return (
    <div className="chat-msg-content chat-msg-content-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre({ children }) {
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
          code(props) {
            const { inline, className, children, ...rest } = props as { inline?: boolean; className?: string; children?: React.ReactNode; [k: string]: unknown };
            if (inline) {
              return (
                <code className="chat-inline-code" {...rest}>
                  {children}
                </code>
              );
            }
            return <>{children}</>;
          },
          p: ({ children }) => <p className="chat-md-p">{children}</p>,
          ul: ({ children }) => <ul className="chat-md-ul">{children}</ul>,
          ol: ({ children }) => <ol className="chat-md-ol">{children}</ol>,
          li: ({ children }) => <li className="chat-md-li">{children}</li>,
          strong: ({ children }) => <strong className="chat-md-strong">{children}</strong>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="chat-md-link">
              {children}
            </a>
          ),
          h1: ({ children }) => <h3 className="chat-md-h1">{children}</h3>,
          h2: ({ children }) => <h3 className="chat-md-h2">{children}</h3>,
          h3: ({ children }) => <h3 className="chat-md-h3">{children}</h3>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export type ToolResult = { name: string; args: Record<string, unknown>; result: unknown };

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

export function ChatToolResults({ results }: { results: ToolResult[] }) {
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

  const count = results.length;
  return (
    <details className="chat-tool-results">
      <summary className="chat-tool-results-summary">
        <span className="chat-tool-results-title">Tool results ({count})</span>
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
        {results.map((tr, i) => (
          <ToolResultChip key={i} name={tr.name} args={tr.args} result={tr.result} />
        ))}
      </div>
    </details>
  );
}

function ToolResultChip({ name, args, result }: { name: string; args: Record<string, unknown>; result: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const displayText = getToolResultDisplayText(result);
  const isObject = typeof result === "object" && result !== null;
  const jsonStr = isObject ? JSON.stringify(result, null, 2) : String(result ?? "");
  const copyText = getToolResultCopyText(result);

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
      {expanded && isObject && (
        <CodeBlock content={jsonStr} lang="json" className="chat-tool-chip-code" />
      )}
    </div>
  );
}
