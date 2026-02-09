"use client";

import { useState, useCallback } from "react";
import { Copy, Check, ChevronDown, ChevronUp } from "lucide-react";

type Part = { type: "text"; content: string } | { type: "code"; content: string; lang?: string };

function parseContent(content: string): Part[] {
  if (!content || typeof content !== "string") return [];
  const parts: Part[] = [];
  const re = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > lastIndex) {
      const text = content.slice(lastIndex, m.index);
      parts.push({ type: "text", content: text });
    }
    parts.push({ type: "code", content: m[2].replace(/\n$/, ""), lang: m[1] || undefined });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < content.length) {
    parts.push({ type: "text", content: content.slice(lastIndex) });
  }
  if (parts.length === 0 && content) {
    parts.push({ type: "text", content });
  }
  return parts;
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

/** Renders text with inline code (`code`) as spans */
function renderTextWithInlineCode(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = /`([^`]+)`/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) {
      nodes.push(<span key={key++}>{text.slice(lastIndex, m.index)}</span>);
    }
    nodes.push(<code key={key++} className="chat-inline-code">{m[1]}</code>);
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    nodes.push(<span key={key++}>{text.slice(lastIndex)}</span>);
  }
  return nodes.length > 0 ? nodes : [text];
}

type Props = {
  content: string;
};

export function ChatMessageContent({ content }: Props) {
  const parts = parseContent(content);
  return (
    <div className="chat-msg-content">
      {parts.map((part, i) =>
        part.type === "text" ? (
          <div key={i} className="chat-msg-text">
            {renderTextWithInlineCode(part.content)}
          </div>
        ) : (
          <CodeBlock key={i} content={part.content} lang={part.lang} />
        )
      )}
    </div>
  );
}

type ToolResult = { name: string; args: Record<string, unknown>; result: unknown };

export function ChatToolResults({ results }: { results: ToolResult[] }) {
  return (
    <div className="chat-tool-results">
      {results.map((tr, i) => (
        <ToolResultChip key={i} name={tr.name} args={tr.args} result={tr.result} />
      ))}
    </div>
  );
}

function ToolResultChip({ name, args, result }: { name: string; args: Record<string, unknown>; result: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const displayText =
    typeof result === "object" && result !== null && "message" in (result as Record<string, unknown>)
      ? String((result as Record<string, unknown>).message)
      : "done";
  const isObject = typeof result === "object" && result !== null;
  const jsonStr = isObject ? JSON.stringify(result, null, 2) : String(result ?? "");

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(jsonStr);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }, [jsonStr]);

  return (
    <div className="chat-tool-chip-wrap">
      <div className="chat-tool-chip">
        <button
          type="button"
          className="chat-tool-chip-expand"
          onClick={() => isObject && setExpanded((e) => !e)}
          title={isObject ? "Expand / collapse" : undefined}
        >
          {name}
          <span className="chat-tool-chip-status">{displayText}</span>
          {isObject && (expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
        </button>
        {(isObject || jsonStr.length > 0) && (
          <button
            type="button"
            className="chat-tool-chip-copy"
            onClick={copy}
            title="Copy JSON / result"
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
          </button>
        )}
      </div>
      {expanded && isObject && (
        <CodeBlock content={jsonStr} lang="json" className="chat-tool-chip-code" />
      )}
    </div>
  );
}
