"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Send, ThumbsUp, ThumbsDown, Loader, Minus, Copy, Check, Circle, Square, MessageSquarePlus, List, Star, Trash2, ExternalLink } from "lucide-react";
import { ChatMessageContent, ChatToolResults } from "./chat-message-content";
import ChatFeedbackModal from "./chat-feedback-modal";

const CHAT_PROVIDER_STORAGE_KEY = "chat.providerId"; // stores provider config id; UI shows models

/** Build a short UI context string for the assistant from the current path. */
function getUiContext(pathname: string | null): string {
  if (!pathname || pathname === "/") return "User is on the home/dashboard.";
  const segments = pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (segments[0] === "workflows") {
    if (segments[1]) return `User is on the workflow detail page (editing workflow id: ${segments[1]}).`;
    return "User is on the workflows list page.";
  }
  if (segments[0] === "agents") {
    if (segments[1]) return `User is on the agent detail page (editing agent id: ${segments[1]}).`;
    return "User is on the agents list page.";
  }
  if (segments[0] === "runs") {
    if (segments[1]) return `User is on the run detail page (run id: ${segments[1]}).`;
    return "User is on the runs list page.";
  }
  if (segments[0] === "tools") {
    if (segments[1]) return `User is on the tool detail page (tool id: ${segments[1]}).`;
    return "User is on the tools list page.";
  }
  if (pathname.startsWith("/knowledge")) return "User is on the knowledge / RAG page.";
  if (pathname.startsWith("/settings")) return "User is on the settings area.";
  if (pathname.startsWith("/requests")) return "User is on the requests page.";
  if (pathname.startsWith("/stats")) return "User is on the stats page.";
  if (pathname.startsWith("/chat")) return "User is on the Agentron chat page.";
  return `User is on: ${pathname}.`;
}

type ToolResult = { name: string; args: Record<string, unknown>; result: unknown };

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolResults?: ToolResult[];
  reasoning?: string;
  todos?: string[];
  completedStepIndices?: number[];
  /** Step currently executing (before todo_done); for in-progress indicator */
  executingStepIndex?: number;
  /** Rephrased user intent for this turn (shown so user can assess) */
  rephrasedPrompt?: string | null;
};

type LlmProvider = { id: string; provider: string; model: string; endpoint?: string };

type ConversationItem = { id: string; title: string | null; rating: number | null; note: string | null; createdAt: number };

type Props = {
  open: boolean;
  onClose: () => void;
  /** When true, render without backdrop/overlay and fill parent (for dedicated /chat page) */
  embedded?: boolean;
  /** When set, the assistant receives this context (e.g. run output) with the next message so it can help without the user pasting. */
  attachedContext?: string | null;
  /** Call after the attached context has been sent so it is not sent again. */
  clearAttachedContext?: () => void;
  /** When opening with run output, wrapper creates a new conversation and passes its id. */
  initialConversationId?: string | null;
  clearInitialConversationId?: () => void;
  /** When provided, error messages in chat show a generic message and a "View stack trace" link that calls this with the current conversation id so the traces view can open that conversation. */
  onOpenStackTraces?: (conversationId?: string) => void;
};

export default function ChatModal({ open, onClose, embedded, attachedContext, clearAttachedContext, initialConversationId, clearInitialConversationId, onOpenStackTraces }: Props) {
  const pathname = usePathname();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationList, setConversationList] = useState<ConversationItem[]>([]);
  const [showConversationList, setShowConversationList] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [providers, setProviders] = useState<LlmProvider[]>([]);
  const [providerId, setProviderId] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(CHAT_PROVIDER_STORAGE_KEY) ?? "";
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // When opened with a new conversation (e.g. run output), use it and don't load messages
  useEffect(() => {
    if (open && initialConversationId) {
      setConversationId(initialConversationId);
      setMessages([]);
      setLoaded(true);
      clearInitialConversationId?.();
    }
  }, [open, initialConversationId, clearInitialConversationId]);

  // When embedded, always show sidebar (classical chat layout)
  useEffect(() => {
    if (embedded) setShowConversationList(true);
  }, [embedded]);

  const startNewChat = useCallback(() => {
    fetch("/api/chat/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) })
      .then((r) => r.json())
      .then((data) => {
        if (data.id) {
          setConversationId(data.id);
          setMessages([]);
          setConversationList((prev) => [{ id: data.id, title: null, rating: null, note: null, createdAt: Date.now() }, ...prev]);
        }
      })
      .catch(() => {});
  }, []);

  const deleteConversation = useCallback(async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const res = await fetch(`/api/chat/conversations/${id}`, { method: "DELETE" });
      if (!res.ok) return;
      const nextList = conversationList.filter((c) => c.id !== id);
      setConversationList(nextList);
      if (conversationId === id) {
        if (nextList.length > 0) {
          setConversationId(nextList[0].id);
          setMessages([]);
        } else {
          setConversationId(null);
          setMessages([]);
          startNewChat();
        }
      }
    } catch {
      // ignore
    }
  }, [conversationId, conversationList, startNewChat]);

  // Fetch conversation list when opening; if no conversation selected, pick first or mark loaded
  useEffect(() => {
    if (open) {
      fetch("/api/chat/conversations")
        .then((r) => r.json())
        .then((data) => {
          const list = Array.isArray(data) ? data : [];
          setConversationList(list);
          if (!conversationId && !initialConversationId) {
            if (list.length > 0) setConversationId(list[0].id);
            else setLoaded(true);
          }
        })
        .catch(() => {
          setConversationList([]);
          if (!conversationId) setLoaded(true);
        });
    }
  }, [open]);

  // Load messages for the current conversation (when we have an id and no initialConversationId)
  useEffect(() => {
    if (!open || !conversationId || initialConversationId) return;
    setLoaded(false);
    fetch(`/api/chat?conversationId=${encodeURIComponent(conversationId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setMessages(data.map((m: Record<string, unknown>) => ({
            id: m.id as string,
            role: m.role as "user" | "assistant",
            content: m.content as string,
            toolResults: m.toolCalls as ToolResult[] | undefined,
          })));
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [open, conversationId]);

  const currentConversation = conversationId ? conversationList.find((c) => c.id === conversationId) : null;
  useEffect(() => {
    setNoteDraft(currentConversation?.note ?? "");
  }, [currentConversation?.id, currentConversation?.note]);

  const saveConversationRating = useCallback(async (rating: number | null) => {
    if (!conversationId) return;
    await fetch(`/api/chat/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating }),
    });
    setConversationList((prev) => prev.map((c) => (c.id === conversationId ? { ...c, rating } : c)));
  }, [conversationId]);

  const saveConversationNote = useCallback(async () => {
    if (!conversationId) return;
    setSavingNote(true);
    try {
      await fetch(`/api/chat/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: noteDraft.trim() || null }),
      });
      setConversationList((prev) => prev.map((c) => (c.id === conversationId ? { ...c, note: noteDraft.trim() || null } : c)));
    } finally {
      setSavingNote(false);
    }
  }, [conversationId, noteDraft]);

  useEffect(() => {
    if (open) {
      fetch("/api/llm/providers")
        .then((r) => r.json())
        .then((data) => {
          const list = Array.isArray(data) ? data : [];
          setProviders(list);
          if (list.length === 1 && typeof window !== "undefined") {
            const only = list[0] as LlmProvider;
            setProviderId((prev) => {
              if (!prev) {
                window.localStorage.setItem(CHAT_PROVIDER_STORAGE_KEY, only.id);
                return only.id;
              }
              return prev;
            });
          }
        })
        .catch(() => setProviders([]));
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, open]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) onClose();
    },
    [onClose]
  );

  const stopRequest = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: text };
    const placeholderId = crypto.randomUUID();
    const placeholderMsg: Message = { id: placeholderId, role: "assistant", content: "" };
    setMessages((prev) => [...prev, userMsg, placeholderMsg]);
    setLoading(true);
    abortRef.current = new AbortController();

    const updatePlaceholder = (updates: Partial<Message>) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === placeholderId ? { ...m, ...updates } : m))
      );
    };

    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const body: { message: string; history: { role: string; content: string }[]; providerId?: string; uiContext?: string; attachedContext?: string; conversationId?: string } = { message: text, history };
      if (providerId) body.providerId = providerId;
      const uiContext = getUiContext(pathname);
      if (uiContext) body.uiContext = uiContext;
      if (attachedContext) {
        body.attachedContext = attachedContext;
        clearAttachedContext?.();
      }
      if (conversationId) body.conversationId = conversationId;
      const res = await fetch("/api/chat?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const raw = await res.text();
        let errMsg = "Request failed";
        try {
          const data = raw ? JSON.parse(raw) : {};
          const e = data.error?.trim().replace(/^\.\s*/, "") || "";
          if (e && e !== ".") errMsg = e;
        } catch {}
        updatePlaceholder({ content: `Error: ${errMsg}` });
        setLoading(false);
        abortRef.current = null;
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      if (!reader) {
        updatePlaceholder({ content: "Error: No response body." });
        setLoading(false);
        abortRef.current = null;
        return;
      }

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const dataMatch = line.match(/^data:\s*(.+)$/m);
            if (!dataMatch) continue;
            try {
              const event = JSON.parse(dataMatch[1].trim()) as { type: string; reasoning?: string; todos?: string[]; index?: number; stepIndex?: number; todoLabel?: string; toolName?: string; content?: string; toolResults?: ToolResult[]; messageId?: string; conversationId?: string; conversationTitle?: string; rephrasedPrompt?: string; completedStepIndices?: number[]; error?: string };
              if (event.type === "rephrased_prompt" && event.rephrasedPrompt != null) {
                updatePlaceholder({ rephrasedPrompt: event.rephrasedPrompt });
              } else if (event.type === "plan") {
                updatePlaceholder({
                  reasoning: event.reasoning ?? "",
                  todos: event.todos ?? [],
                  completedStepIndices: [],
                  executingStepIndex: undefined,
                });
              } else if (event.type === "step_start" && event.stepIndex !== undefined) {
                updatePlaceholder({ executingStepIndex: event.stepIndex });
              } else if (event.type === "todo_done" && event.index !== undefined) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === placeholderId
                      ? {
                          ...m,
                          completedStepIndices: [...(m.completedStepIndices ?? []), event.index!],
                          executingStepIndex: undefined,
                        }
                      : m
                  )
                );
              } else if (event.type === "done") {
                updatePlaceholder({
                  content: event.content ?? "",
                  toolResults: event.toolResults,
                  ...(event.reasoning !== undefined && { reasoning: event.reasoning }),
                  ...(event.todos !== undefined && { todos: event.todos }),
                  completedStepIndices: event.completedStepIndices,
                  executingStepIndex: undefined,
                  ...(event.rephrasedPrompt !== undefined && { rephrasedPrompt: event.rephrasedPrompt }),
                });
                if (event.messageId) {
                  setMessages((prev) =>
                    prev.map((m) => (m.id === placeholderId ? { ...m, id: event.messageId! } : m))
                  );
                }
                if (event.conversationId) {
                  setConversationId(event.conversationId);
                  const newTitle = event.conversationTitle ?? null;
                  setConversationList((prev) => {
                    const has = prev.some((c) => c.id === event.conversationId);
                    if (has) {
                      return prev.map((c) => (c.id === event.conversationId ? { ...c, title: newTitle ?? c.title } : c));
                    }
                    return [{ id: event.conversationId!, title: newTitle, rating: null, note: null, createdAt: Date.now() }, ...prev];
                  });
                }
              } else if (event.type === "error") {
                const errorContent = `Error: ${event.error ?? "Unknown error"}`;
                if (event.messageId) {
                  setMessages((prev) =>
                    prev.map((m) => (m.id === placeholderId ? { ...m, id: event.messageId!, content: errorContent } : m))
                  );
                } else {
                  updatePlaceholder({ content: errorContent });
                }
              }
            } catch {
              // skip malformed event
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        updatePlaceholder({ content: "Request stopped." });
        setInput(text);
      } else {
        updatePlaceholder({ content: "Failed to reach assistant." });
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const rateFeedback = async (msg: Message, label: "good" | "bad") => {
    const prevUser = messages[messages.indexOf(msg) - 1];
    await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType: "chat",
        targetId: "chat",
        input: prevUser?.content ?? "",
        output: msg.content,
        label,
      }),
    });
  };

  return (
    <>
      {/* Backdrop -- clicking it closes the modal (only when not embedded) */}
      {open && !embedded && (
        <div
          className="chat-backdrop"
          ref={backdropRef}
          onClick={handleBackdropClick}
        />
      )}

      <div className={`chat-panel ${open ? "chat-panel-open" : ""} ${embedded ? "chat-panel-embedded" : ""}`}>
        {/* Conversation list sidebar - collapsible when embedded */}
        {showConversationList && (
          <div className={`chat-conversations-sidebar ${embedded ? "chat-conversations-sidebar-embedded" : ""}`}>
            <div className="chat-conversations-header">
              <span>Conversations</span>
              <button type="button" className="chat-header-btn" onClick={() => setShowConversationList(false)} title={embedded ? "Close sidebar" : "Close list"}>
                <Minus size={14} />
              </button>
            </div>
            <button type="button" className="chat-new-chat-btn" onClick={startNewChat}>
              <MessageSquarePlus size={16} />
              <span>New chat</span>
            </button>
            <ul className="chat-conversations-list">
              {conversationList.map((c) => (
                <li key={c.id} className="chat-conversation-li">
                  <button
                    type="button"
                    className={`chat-conversation-item ${c.id === conversationId ? "active" : ""}`}
                    onClick={() => {
                      setConversationId(c.id);
                      if (!embedded) setShowConversationList(false);
                    }}
                  >
                    <span className="chat-conversation-item-title">
                      {(c.title && c.title.trim()) ? c.title.trim() : "New chat"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="chat-conversation-delete"
                    onClick={(e) => deleteConversation(c.id, e)}
                    title="Delete chat"
                    aria-label="Delete chat"
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* Main area: header + messages + input (wrapped for embedded row layout) */}
        <div className="chat-main">
        <div className="chat-header">
          <button
            type="button"
            className="chat-header-btn"
            onClick={() => setShowConversationList((s) => !s)}
            title={showConversationList ? "Close sidebar" : "Open conversations"}
          >
            <List size={14} />
          </button>
          <div className="chat-header-title">
            <div className="chat-header-dot" />
            <span>Agentron</span>
          </div>
          <select
            className="chat-provider-select"
            value={providerId}
            onChange={(e) => {
              const id = e.target.value;
              setProviderId(id);
              if (typeof window !== "undefined") {
                if (id) window.localStorage.setItem(CHAT_PROVIDER_STORAGE_KEY, id);
                else window.localStorage.removeItem(CHAT_PROVIDER_STORAGE_KEY);
              }
            }}
            title={providers.length > 1 ? "Select a provider (required when multiple are configured)" : "LLM provider for this chat"}
          >
            <option value="">{providers.length > 1 ? "Select a provider…" : "Default"}</option>
            {[...providers]
              .sort((a, b) => a.model.localeCompare(b.model, undefined, { sensitivity: "base" }) || a.provider.localeCompare(b.provider))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.model} ({p.provider})
                </option>
              ))}
          </select>
          {!embedded && (
            <button className="chat-header-btn" onClick={onClose} title="Minimize">
              <Minus size={14} />
            </button>
          )}
        </div>

        {attachedContext && (
          <div className="chat-attached-banner" style={{ padding: "0.5rem 0.75rem", background: "var(--surface-muted)", borderBottom: "1px solid var(--border)", fontSize: "0.8rem", color: "var(--text-muted)" }}>
            Run output attached — ask anything and the assistant will use it to help.
          </div>
        )}

        {/* Messages */}
        <div className="chat-messages" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="chat-empty">
              <div className="chat-empty-icon">AI</div>
              <p className="chat-empty-title">How can I help?</p>
              <p className="chat-empty-sub">
                Create agents, write functions, manage sandboxes, and more.
              </p>
            </div>
          )}
          {messages.map((msg, index) => {
            const isLastMessage = index === messages.length - 1;
            const hideActionsWhileThinking = loading && isLastMessage && msg.role === "assistant";
            return (
            <div key={msg.id} className={`chat-msg chat-msg-${msg.role}`}>
              {msg.role === "assistant" && msg.rephrasedPrompt != null && msg.rephrasedPrompt.trim() !== "" && (
                <div className="chat-rephrased-prompt" style={{ marginBottom: "0.75rem", padding: "0.5rem 0.75rem", background: "var(--surface-muted)", borderRadius: 6, borderLeft: "3px solid var(--border)", fontSize: "0.85rem" }}>
                  <span style={{ fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: "0.25rem" }}>Rephrased prompt</span>
                  <p style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{msg.rephrasedPrompt}</p>
                </div>
              )}
              {msg.role === "assistant" && isLastMessage && loading && (() => {
                const stepIndex = msg.executingStepIndex;
                const todos = msg.todos ?? [];
                const total = todos.length;
                let status: string;
                if (stepIndex !== undefined && total > 0 && todos[stepIndex] != null) {
                  status = total > 1 ? `Step ${stepIndex + 1} of ${total}: ${todos[stepIndex]}` : String(todos[stepIndex]);
                } else if (todos.length > 0 || (msg.reasoning != null && String(msg.reasoning).trim() !== "")) {
                  status = "Planning…";
                } else {
                  status = "Thinking…";
                }
                return (
                  <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", display: "inline-flex", alignItems: "center", gap: "0.35rem", marginBottom: "0.25rem" }}>
                    <Loader size={12} className="spin" style={{ flexShrink: 0, color: "var(--text-muted)" }} />
                    {status}
                  </span>
                );
              })()}
              {msg.role === "assistant" && msg.reasoning && isLastMessage && loading && (
                <div className="chat-plan">
                  <div className="chat-plan-reasoning">
                    <span className="chat-plan-label">Reasoning</span>
                    <p className="chat-plan-reasoning-text">{msg.reasoning}</p>
                  </div>
                </div>
              )}
              {msg.role === "assistant" && msg.todos && msg.todos.length > 0 && (
                <div className="chat-plan chat-plan-todos-only">
                  <div className="chat-plan-todos">
                    <span className="chat-plan-label">Steps</span>
                    <ul className="chat-plan-todo-list">
                      {msg.todos.map((todo, i) => {
                        const done = msg.completedStepIndices?.includes(i);
                        const executing = msg.executingStepIndex === i;
                        return (
                          <li key={i} className={`chat-plan-todo-item ${done ? "chat-plan-todo-done" : ""} ${executing ? "chat-plan-todo-executing" : ""}`}>
                            {done ? <Check size={12} className="chat-plan-todo-icon" /> : executing ? <Loader size={12} className="chat-plan-todo-icon chat-plan-todo-spinner" /> : <Circle size={12} className="chat-plan-todo-icon" />}
                            <span>{todo}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              )}
              {msg.role === "assistant" && msg.content.startsWith("Error: ") ? (
                <div className="chat-msg-error-placeholder">
                  <p style={{ margin: 0, color: "var(--text-muted)" }}>An error occurred.</p>
                  {onOpenStackTraces ? (
                    <button type="button" className="chat-view-traces-btn" onClick={() => onOpenStackTraces(conversationId ?? undefined)}>
                      View stack trace for details
                    </button>
                  ) : (
                    <Link href={conversationId ? `/chat?tab=traces&conversationId=${encodeURIComponent(conversationId)}` : "/chat?tab=traces"} className="chat-view-traces-link">
                      View stack trace for details <ExternalLink size={12} />
                    </Link>
                  )}
                </div>
              ) : (
                <ChatMessageContent content={msg.content} />
              )}
              {msg.toolResults && msg.toolResults.length > 0 && <ChatToolResults results={msg.toolResults} />}
              {msg.role === "assistant" && !hideActionsWhileThinking && (
                <div className="chat-msg-actions">
                  <button
                    className="chat-rate-btn"
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(msg.content);
                      } catch {}
                    }}
                    title="Copy as plain text"
                  >
                    <Copy size={11} />
                  </button>
                  <button className="chat-rate-btn" onClick={() => rateFeedback(msg, "good")} title="Good"><ThumbsUp size={11} /></button>
                  <button className="chat-rate-btn" onClick={() => rateFeedback(msg, "bad")} title="Bad"><ThumbsDown size={11} /></button>
                </div>
              )}
            </div>
          );
          })}
          {loading && (
            <div className="chat-msg chat-msg-assistant">
              <div className="chat-typing">
                <span /><span /><span />
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="chat-input-bar">
          <input
            className="chat-input"
            placeholder="Message assistant..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
            disabled={loading}
          />
          {loading ? (
            <button type="button" className="chat-stop-btn" onClick={stopRequest} title="Stop">
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button className="chat-send-btn" onClick={send} disabled={!input.trim()}>
              <Send size={14} />
            </button>
          )}
        </div>
        {/* Feedback trigger */}
        <div
          className="chat-feedback-trigger"
          style={{
            padding: "0.4rem 0.75rem",
            borderTop: "1px solid var(--border)",
            background: "var(--surface-muted)",
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={() => setShowFeedbackModal(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.35rem",
              padding: "0.25rem 0.5rem",
              fontSize: "0.8rem",
              color: "var(--text-muted)",
              background: "none",
              border: "none",
              cursor: "pointer",
              borderRadius: 6,
            }}
          >
            <Star size={14} />
            Feedback
          </button>
        </div>
        </div>
      </div>
      {showFeedbackModal && (
        <div style={{ position: "absolute", inset: 0, zIndex: 14 }}>
          <ChatFeedbackModal
            open={showFeedbackModal}
            onClose={() => setShowFeedbackModal(false)}
            conversationId={conversationId}
            currentConversation={currentConversation ?? null}
            noteDraft={noteDraft}
            setNoteDraft={setNoteDraft}
            savingNote={savingNote}
            saveConversationRating={saveConversationRating}
            saveConversationNote={saveConversationNote}
          />
        </div>
      )}
    </>
  );
}
