"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import {
  Send,
  Loader,
  Square,
  MessageSquarePlus,
  List,
  PanelLeftClose,
  Trash2,
  ExternalLink,
  GitBranch,
  Settings2,
  Copy,
  Check,
  Circle,
  ThumbsUp,
  ThumbsDown,
  Star,
} from "lucide-react";
import { ChatMessageContent, ChatToolResults } from "./chat-message-content";
import ChatFeedbackModal from "./chat-feedback-modal";

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
  if (pathname.startsWith("/knowledge")) return "User is on the knowledge / RAG page.";
  if (pathname.startsWith("/settings")) return "User is on the settings area.";
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
  executingStepIndex?: number;
  rephrasedPrompt?: string | null;
};

type ConversationItem = { id: string; title: string | null; rating: number | null; note: string | null; createdAt: number };
type LlmProvider = { id: string; provider: string; model: string; endpoint?: string };

type Props = {
  onOpenSettings?: () => void;
};

export default function ChatSection({ onOpenSettings }: Props) {
  const pathname = usePathname();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationList, setConversationList] = useState<ConversationItem[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [providers, setProviders] = useState<LlmProvider[]>([]);
  const [providerId, setProviderId] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

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

  useEffect(() => {
    fetch("/api/chat/conversations")
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setConversationList(list);
        if (!conversationId && list.length > 0) setConversationId(list[0].id);
        else if (!conversationId) setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!conversationId) return;
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
  }, [conversationId]);

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
    fetch("/api/llm/providers")
      .then((r) => r.json())
      .then((data) => setProviders(Array.isArray(data) ? data : []))
      .catch(() => setProviders([]));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const stopRequest = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(async () => {
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
      setMessages((prev) => prev.map((m) => (m.id === placeholderId ? { ...m, ...updates } : m)));
    };
    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const body: Record<string, unknown> = { message: text, history };
      if (providerId) body.providerId = providerId;
      body.uiContext = getUiContext(pathname);
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
              const event = JSON.parse(dataMatch[1].trim()) as {
                type: string;
                reasoning?: string;
                todos?: string[];
                index?: number;
                stepIndex?: number;
                content?: string;
                toolResults?: ToolResult[];
                messageId?: string;
                conversationId?: string;
                conversationTitle?: string;
                rephrasedPrompt?: string;
                completedStepIndices?: number[];
                error?: string;
              };
              if (event.type === "rephrased_prompt" && event.rephrasedPrompt != null) updatePlaceholder({ rephrasedPrompt: event.rephrasedPrompt });
              else if (event.type === "plan") updatePlaceholder({ reasoning: event.reasoning ?? "", todos: event.todos ?? [], completedStepIndices: [], executingStepIndex: undefined });
              else if (event.type === "step_start" && event.stepIndex !== undefined) updatePlaceholder({ executingStepIndex: event.stepIndex });
              else if (event.type === "todo_done" && event.index !== undefined) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === placeholderId ? { ...m, completedStepIndices: [...(m.completedStepIndices ?? []), event.index!], executingStepIndex: undefined } : m
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
                if (event.messageId) setMessages((prev) => prev.map((m) => (m.id === placeholderId ? { ...m, id: event.messageId! } : m)));
                if (event.conversationId) {
                  setConversationId(event.conversationId);
                  const newTitle = event.conversationTitle ?? null;
                  setConversationList((prev) => {
                    const has = prev.some((c) => c.id === event.conversationId);
                    if (has) return prev.map((c) => (c.id === event.conversationId ? { ...c, title: newTitle ?? c.title } : c));
                    return [{ id: event.conversationId!, title: newTitle, rating: null, note: null, createdAt: Date.now() }, ...prev];
                  });
                }
              } else if (event.type === "error") {
                const errorContent = `Error: ${event.error ?? "Unknown error"}`;
                if (event.messageId) setMessages((prev) => prev.map((m) => (m.id === placeholderId ? { ...m, id: event.messageId!, content: errorContent } : m)));
                else updatePlaceholder({ content: errorContent });
              }
            } catch {
              // skip
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
  }, [input, loading, messages, providerId, conversationId, pathname]);

  const rateFeedback = useCallback(async (msg: Message, label: "good" | "bad") => {
    const prevUser = messages[messages.indexOf(msg) - 1];
    await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetType: "chat", targetId: "chat", input: prevUser?.content ?? "", output: msg.content, label }),
    });
  }, [messages]);

  return (
    <section className="chat-section">
      {sidebarOpen && (
        <aside className="chat-section-sidebar">
          <div className="chat-section-sidebar-header">
            <button type="button" className="chat-section-sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar">
              <PanelLeftClose size={18} />
            </button>
            <span className="chat-section-sidebar-title">Chat</span>
          </div>
          <button type="button" className="chat-section-new-chat" onClick={startNewChat}>
            <MessageSquarePlus size={18} />
            New chat
          </button>
          <ul className="chat-section-conversations">
            {conversationList.map((c) => (
              <li key={c.id} className="chat-section-conv-item">
                <button
                  type="button"
                  className={`chat-section-conv-btn ${c.id === conversationId ? "active" : ""}`}
                  onClick={() => setConversationId(c.id)}
                >
                  <span className="chat-section-conv-title">{(c.title && c.title.trim()) ? c.title.trim() : "New chat"}</span>
                </button>
                <button type="button" className="chat-section-conv-delete" onClick={(e) => deleteConversation(c.id, e)} title="Delete" aria-label="Delete">
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
          <div className="chat-section-sidebar-footer">
            <a href={conversationId ? `/chat/traces?conversationId=${encodeURIComponent(conversationId)}` : "/chat/traces"} target="_blank" rel="noopener noreferrer" className="chat-section-sidebar-link">
              <GitBranch size={16} />
              Stack traces
            </a>
            {onOpenSettings && (
              <button type="button" className="chat-section-sidebar-link" onClick={onOpenSettings}>
                <Settings2 size={16} />
                Settings
              </button>
            )}
          </div>
        </aside>
      )}

      <div className="chat-section-main">
        <header className="chat-section-header">
          {!sidebarOpen && (
            <button type="button" className="chat-section-menu-btn" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar">
              <List size={20} />
            </button>
          )}
          <span className="chat-section-brand">Agentron</span>
          <select
            className="chat-section-model-select"
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
            title="Select model"
          >
            <option value="">Select model…</option>
            {[...providers]
              .sort((a, b) => a.model.localeCompare(b.model, undefined, { sensitivity: "base" }) || a.provider.localeCompare(b.provider))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.model} ({p.provider})
                </option>
              ))}
          </select>
        </header>

        <div className="chat-section-messages" ref={scrollRef}>
          {!loaded ? (
            <div className="chat-section-loading">Loading…</div>
          ) : messages.length === 0 ? (
            <div className="chat-section-welcome">
              <div className="chat-section-welcome-icon">AI</div>
              <h2 className="chat-section-welcome-title">How can I help?</h2>
              <p className="chat-section-welcome-sub">Ask anything about agents, workflows, and tools.</p>
            </div>
          ) : (
            <div className="chat-section-message-list">
              {messages.map((msg, index) => {
                const isLast = index === messages.length - 1;
                const hideActions = loading && isLast && msg.role === "assistant";
                return (
                  <div key={msg.id} className={`chat-section-msg chat-section-msg-${msg.role}`}>
                    {msg.role === "assistant" && msg.rephrasedPrompt != null && msg.rephrasedPrompt.trim() !== "" && (
                      <div className="chat-section-rephrased">
                        <span className="chat-section-rephrased-label">Rephrased</span>
                        <p className="chat-section-rephrased-text">{msg.rephrasedPrompt}</p>
                      </div>
                    )}
                    {msg.role === "assistant" && isLast && loading && (
                      <span className="chat-section-typing">
                        <Loader size={14} className="spin" />
                        {msg.todos?.length ? `Step ${(msg.executingStepIndex ?? 0) + 1} of ${msg.todos.length}` : "Thinking…"}
                      </span>
                    )}
                    {msg.role === "assistant" && msg.reasoning && isLast && loading && (
                      <div className="chat-section-plan">
                        <span className="chat-section-plan-label">Reasoning</span>
                        <p className="chat-section-plan-text">{msg.reasoning}</p>
                      </div>
                    )}
                    {msg.role === "assistant" && msg.todos && msg.todos.length > 0 && (
                      <ul className="chat-section-todos">
                        {msg.todos.map((todo, i) => (
                          <li key={i} className={msg.completedStepIndices?.includes(i) ? "done" : msg.executingStepIndex === i ? "active" : ""}>
                            {msg.completedStepIndices?.includes(i) ? <Check size={12} /> : msg.executingStepIndex === i ? <Loader size={12} className="spin" /> : <Circle size={12} />}
                            {todo}
                          </li>
                        ))}
                      </ul>
                    )}
                    {msg.role === "assistant" && msg.content.startsWith("Error: ") ? (
                      <div className="chat-section-error">
                        <p>Something went wrong.</p>
                        <a href={conversationId ? `/chat/traces?conversationId=${encodeURIComponent(conversationId)}` : "/chat/traces"} target="_blank" rel="noopener noreferrer">
                          View stack trace <ExternalLink size={12} />
                        </a>
                      </div>
                    ) : (
                      <ChatMessageContent content={msg.content} />
                    )}
                    {msg.toolResults && msg.toolResults.length > 0 && <ChatToolResults results={msg.toolResults} />}
                    {msg.role === "assistant" && !hideActions && (
                      <div className="chat-section-msg-actions">
                        <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(msg.content); } catch {} }} title="Copy">
                          <Copy size={14} />
                        </button>
                        <button type="button" onClick={() => rateFeedback(msg, "good")} title="Good"><ThumbsUp size={14} /></button>
                        <button type="button" onClick={() => rateFeedback(msg, "bad")} title="Bad"><ThumbsDown size={14} /></button>
                      </div>
                    )}
                  </div>
                );
              })}
              {loading && (
                <div className="chat-section-msg chat-section-msg-assistant">
                  <div className="chat-section-typing-dots"><span /><span /><span /></div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="chat-section-input-wrap">
          <div className="chat-section-input-inner">
            <input
              className="chat-section-input"
              placeholder="Message Agentron…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
              disabled={loading}
            />
            {loading ? (
              <button type="button" className="chat-section-send" onClick={stopRequest} title="Stop"><Square size={18} fill="currentColor" /></button>
            ) : (
              <button
                type="button"
                className="chat-section-send"
                onClick={send}
                disabled={!input.trim() || !providerId}
                title={!providerId ? "Select a model" : "Send"}
              >
                <Send size={18} />
              </button>
            )}
          </div>
          <button type="button" className="chat-section-feedback-btn" onClick={() => setShowFeedbackModal(true)}>
            <Star size={14} /> Feedback
          </button>
        </div>
      </div>

      {showFeedbackModal && (
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
      )}
    </section>
  );
}
