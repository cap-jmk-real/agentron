"use client";

import { useState, useEffect, useCallback } from "react";
import { MessageCircle, ChevronDown, ChevronRight, Copy, Check } from "lucide-react";

type ConversationItem = { id: string; title: string | null; rating: number | null; note: string | null; createdAt: number };

type ChatMessage = {
  id: string;
  role: string;
  content: string;
  toolCalls?: Array<{ id?: string; name: string; arguments?: Record<string, unknown>; result?: unknown }>;
  createdAt?: number;
};

function formatValue(v: unknown): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (!text) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      type="button"
      onClick={copy}
      disabled={!text}
      title={`Copy ${label}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.25rem",
        padding: "0.2rem 0.4rem",
        fontSize: "0.75rem",
        border: "1px solid var(--border)",
        borderRadius: 4,
        background: "var(--surface)",
        cursor: text ? "pointer" : "default",
        color: "var(--text-muted)",
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? "Copied" : label}
    </button>
  );
}

function TurnCard({ turn, index }: { turn: Turn; index: number }) {
  const [expanded, setExpanded] = useState(true);
  const userText = (turn.user.content ?? "").trim();
  const turnSectionText = turnToTraceSection(turn, index);
  const hasAssistant = turn.assistant != null;
  const hasTools = Array.isArray(turn.assistant?.toolCalls) && turn.assistant.toolCalls.length > 0;

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        overflow: "hidden",
        background: "var(--surface-muted)",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%",
          padding: "0.6rem 0.75rem",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          fontSize: "0.9rem",
        }}
      >
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span style={{ fontWeight: 600, color: "var(--text-muted)", minWidth: 24 }}>#{index + 1}</span>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {userText.slice(0, 50) || "User message"}
          {userText.length > 50 ? "…" : ""}
        </span>
        {hasTools && (
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", background: "var(--surface)", padding: "0.1rem 0.35rem", borderRadius: 4 }}>
            {turn.assistant!.toolCalls!.length} tool call(s)
          </span>
        )}
      </button>
      {expanded && (
        <div style={{ padding: "0 0.75rem 0.75rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.25rem" }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)" }}>User input</span>
            </div>
            <pre style={{ margin: 0, padding: "0.5rem", background: "var(--surface)", borderRadius: 6, fontSize: "0.8rem", overflow: "auto", maxHeight: 180, whiteSpace: "pre-wrap" }}>
              {userText || "—"}
            </pre>
          </div>
          {hasAssistant && (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.25rem" }}>
                <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)" }}>Model output</span>
                <CopyBtn text={turnSectionText} label="Copy this turn" />
              </div>
              {turn.assistant!.content?.trim() && (
                <pre style={{ margin: 0, padding: "0.5rem", background: "var(--surface)", borderRadius: 6, fontSize: "0.8rem", overflow: "auto", maxHeight: 200, whiteSpace: "pre-wrap" }}>
                  {turn.assistant.content}
                </pre>
              )}
              {hasTools &&
                turn.assistant!.toolCalls!.map((tc, i) => (
                  <div key={i} style={{ borderLeft: "3px solid var(--border)", paddingLeft: "0.5rem", marginTop: "0.35rem" }}>
                    <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)" }}>Tool: {tc.name}</div>
                    {tc.arguments != null && Object.keys(tc.arguments).length > 0 && (
                      <pre style={{ margin: "0.2rem 0 0 0", padding: "0.35rem", background: "var(--surface)", borderRadius: 4, fontSize: "0.75rem", overflow: "auto", maxHeight: 120 }}>
                        {formatValue(tc.arguments)}
                      </pre>
                    )}
                    {tc.result !== undefined && (
                      <pre style={{ margin: "0.2rem 0 0 0", padding: "0.35rem", background: "var(--surface)", borderRadius: 4, fontSize: "0.75rem", overflow: "auto", maxHeight: 120 }}>
                        {formatValue(tc.result)}
                      </pre>
                    )}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One turn = one user message and the following assistant message (if any). */
type Turn = { user: ChatMessage; assistant?: ChatMessage };

function messagesToTurns(messages: ChatMessage[]): Turn[] {
  const turns: Turn[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "user") {
      const assistant = messages[i + 1]?.role === "assistant" ? messages[i + 1] : undefined;
      turns.push({ user: messages[i], assistant });
      if (assistant) i++;
    }
  }
  return turns;
}

function turnToTraceSection(turn: Turn, index: number): string {
  const lines: string[] = [`--- Turn #${index + 1} ---`, "User input:", (turn.user.content ?? "").trim(), "", "Model output:"];
  if (turn.assistant?.content?.trim()) lines.push(turn.assistant.content.trim());
  const toolCalls = turn.assistant?.toolCalls;
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    toolCalls.forEach((tc, j) => {
      lines.push(`Tool ${j + 1}: ${tc.name}`);
      if (tc.arguments != null && typeof tc.arguments === "object") {
        lines.push("  Arguments: " + JSON.stringify(tc.arguments));
      }
      if (tc.result !== undefined) {
        lines.push("  Result: " + (typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result)));
      }
    });
  }
  lines.push("");
  return lines.join("\n");
}

function buildTraceText(conversationTitle: string | null, turns: Turn[]): string {
  const lines: string[] = [
    "[Chat Assistant Trace]",
    `Conversation: ${(conversationTitle && conversationTitle.trim()) || "New chat"}`,
    "",
  ];
  turns.forEach((turn, i) => {
    lines.push(turnToTraceSection(turn, i));
  });
  return lines.join("\n");
}


type ChatAssistantTracesViewProps = {
  /** When set, this conversation is selected so the user lands on the right trace (e.g. after "View stack trace" from a chat error). */
  initialConversationId?: string | null;
  /** Call once the initial conversation has been applied so the parent can clear it. */
  clearInitialConversationId?: () => void;
};

export default function ChatAssistantTracesView({ initialConversationId, clearInitialConversationId }: ChatAssistantTracesViewProps = {}) {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadConversations = useCallback(async () => {
    setLoadingConvs(true);
    try {
      const res = await fetch("/api/chat/conversations", { cache: "no-store" });
      const data = await res.json();
      setConversations(Array.isArray(data) ? data : []);
    } catch {
      setConversations([]);
    } finally {
      setLoadingConvs(false);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!initialConversationId) return;
    let cancelled = false;
    loadConversations().then(() => {
      if (!cancelled) {
        setSelectedId(initialConversationId);
        clearInitialConversationId?.();
      }
    });
    return () => { cancelled = true; };
  }, [initialConversationId, clearInitialConversationId, loadConversations]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    setLoadingMessages(true);
    fetch(`/api/chat?conversationId=${encodeURIComponent(selectedId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        setMessages(Array.isArray(data) ? data : []);
      })
      .catch(() => setMessages([]))
      .finally(() => setLoadingMessages(false));
  }, [selectedId]);

  const turns = messagesToTurns(messages);
  const selectedConv = selectedId ? conversations.find((c) => c.id === selectedId) : null;

  const handleCopyTrace = useCallback(() => {
    const text = buildTraceText(selectedConv?.title ?? null, turns);
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [selectedConv?.title, turns]);

  return (
    <div className="chat-assistant-traces-view" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
        <MessageCircle size={18} style={{ color: "var(--text-muted)" }} />
        <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>Chat assistant traces</h2>
        <button type="button" className="button button-secondary" onClick={loadConversations} style={{ marginLeft: "auto", fontSize: "0.8rem" }}>
          Refresh
        </button>
        {selectedId && turns.length > 0 && (
          <button
            type="button"
            className="button button-secondary"
            onClick={handleCopyTrace}
            style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.8rem" }}
            title="Copy full stack trace (user inputs + model outputs + tool calls)"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy full trace"}
          </button>
        )}
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div
          style={{
            width: 260,
            minWidth: 200,
            flexShrink: 0,
            borderRight: "1px solid var(--border)",
            overflowY: "auto",
            padding: "0.5rem",
          }}
        >
          {loadingConvs && <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Loading…</p>}
          {!loadingConvs && conversations.length === 0 && (
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>No conversations yet.</p>
          )}
          {!loadingConvs &&
            conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedId(c.id)}
                style={{
                  width: "100%",
                  padding: "0.5rem 0.6rem",
                  marginBottom: "0.25rem",
                  textAlign: "left",
                  background: selectedId === c.id ? "var(--surface-muted)" : "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: "0.8rem",
                }}
              >
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {(c.title && c.title.trim()) || "Chat"}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>
                  {new Date(c.createdAt).toLocaleString()}
                </div>
              </button>
            ))}
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "1rem", minWidth: 0 }}>
          {!selectedId && (
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Select a conversation to view the full stack trace (user input, model output, tool calls).</p>
          )}
          {selectedId && loadingMessages && <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Loading…</p>}
          {selectedId && !loadingMessages && (
            <>
              {selectedConv && (
                <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
                  {(selectedConv.title && selectedConv.title.trim()) || "Chat"} — {turns.length} turn(s). Copy the full trace above or copy each section per turn.
                </p>
              )}
              {turns.length === 0 ? (
                <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>No messages in this conversation.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {turns.map((turn, i) => (
                    <TurnCard key={`${turn.user.id}-${turn.assistant?.id ?? "none"}`} turn={turn} index={i} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
