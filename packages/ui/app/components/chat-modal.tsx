"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { flushSync } from "react-dom";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Send, ThumbsUp, ThumbsDown, Loader, Minus, Copy, Check, Circle, Square, MessageSquarePlus, List, Star, Trash2, ExternalLink, GitBranch, Settings2 } from "lucide-react";
import { ChatMessageContent, ChatToolResults, getAssistantMessageDisplayContent, ReasoningContent } from "./chat-message-content";
import ChatFeedbackModal from "./chat-feedback-modal";
import LogoLoading from "./logo-loading";
import BrandIcon from "./brand-icon";

/** UUID v4; works in insecure context where crypto.randomUUID is not available */
function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

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

type TraceStep = { phase: string; label?: string; contentPreview?: string };

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
  /** Tool name currently executing (from step_start) */
  executingToolName?: string;
  /** Todo label for current step */
  executingTodoLabel?: string;
  /** Optional substep label (e.g. "List LLM providers") */
  executingSubStepLabel?: string;
  /** Rephrased user intent for this turn (shown so user can assess) */
  rephrasedPrompt?: string | null;
  /** Live trace steps during thinking (e.g. "Rephrasing…", "Calling LLM…") */
  traceSteps?: TraceStep[];
};

/** Copy text to clipboard; works in insecure contexts (HTTP) via execCommand fallback. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to fallback
  }
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

function getToolResultCopyLine(result: unknown): string {
  if (result === null || result === undefined) return "done";
  if (typeof result === "object" && "message" in (result as Record<string, unknown>))
    return String((result as Record<string, unknown>).message);
  if (typeof result === "string") return result;
  return "done";
}

function getMessageCopyText(msg: Message): string {
  const parts: string[] = [];
  if (msg.content.trim()) parts.push(msg.content.trim());
  if (msg.toolResults && msg.toolResults.length > 0) {
    parts.push("");
    parts.push("Tool results:");
    for (const r of msg.toolResults) {
      parts.push(`${r.name}: ${getToolResultCopyLine(r.result)}`);
    }
  }
  return parts.join("\n");
}

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
  /** When provided, error messages in chat show a generic message and a "View stack trace" link that opens /chat/traces in a new tab. */
  onOpenStackTraces?: (conversationId?: string) => void;
  /** When embedded (e.g. on /chat page), called when user clicks Settings in the sidebar. */
  onOpenSettings?: () => void;
};

export default function ChatModal({ open, onClose, embedded, attachedContext, clearAttachedContext, initialConversationId, clearInitialConversationId, onOpenStackTraces, onOpenSettings }: Props) {
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
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [providers, setProviders] = useState<LlmProvider[]>([]);
  const [providerId, setProviderId] = useState<string>("");
  const CHAT_DEFAULT_PROVIDER_KEY = "chat-default-provider-id";
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

  // Load messages only when conversationId changes (e.g. user switched conversation). Do NOT refetch when
  // reopening the FAB so that in-progress state (agent thinking) and current messages remain visible.
  useEffect(() => {
    if (!conversationId || initialConversationId) return;
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
  }, [conversationId, initialConversationId]);

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
    if (embedded) setShowConversationList(true);
  }, [embedded]);

  useEffect(() => {
    if (open) {
      fetch("/api/llm/providers")
        .then((r) => r.json())
        .then((data) => {
          const list = Array.isArray(data) ? data : [];
          setProviders(list);
          const saved = typeof localStorage !== "undefined" ? localStorage.getItem(CHAT_DEFAULT_PROVIDER_KEY) : null;
          const valid = saved && list.some((p: LlmProvider) => p.id === saved);
          setProviderId(valid ? saved : (list[0]?.id ?? ""));
        })
        .catch(() => setProviders([]));
    }
  }, [open]);

  const handleProviderChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setProviderId(value);
    if (typeof localStorage !== "undefined" && value) localStorage.setItem(CHAT_DEFAULT_PROVIDER_KEY, value);
  }, []);

  useEffect(() => {
    if (open) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, open]);

  useEffect(() => {
    if (!showConversationList) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowConversationList(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showConversationList]);

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

    const userMsg: Message = { id: randomId(), role: "user", content: text };
    const placeholderId = randomId();
    const placeholderMsg: Message = { id: placeholderId, role: "assistant", content: "" };
    setMessages((prev) => [...prev, userMsg, placeholderMsg]);
    setLoading(true);
    abortRef.current = new AbortController();

    const updatePlaceholder = (updates: Partial<Message>, flush = false) => {
      const updater = () =>
        setMessages((prev) =>
          prev.map((m) => (m.id === placeholderId ? { ...m, ...updates } : m))
        );
      if (flush) flushSync(updater);
      else updater();
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
              const event = JSON.parse(dataMatch[1].trim()) as { type: string; reasoning?: string; todos?: string[]; index?: number; stepIndex?: number; todoLabel?: string; toolName?: string; content?: string; toolResults?: ToolResult[]; messageId?: string; userMessageId?: string; conversationId?: string; conversationTitle?: string; rephrasedPrompt?: string; completedStepIndices?: number[]; error?: string; phase?: string; label?: string; contentPreview?: string };
              if (event.type === "trace_step") {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === placeholderId
                      ? { ...m, traceSteps: [...(m.traceSteps ?? []), { phase: event.phase ?? "", label: event.label, contentPreview: event.contentPreview }] }
                      : m
                  )
                );
              } else if (event.type === "rephrased_prompt" && event.rephrasedPrompt != null) {
                updatePlaceholder({ rephrasedPrompt: event.rephrasedPrompt });
              } else if (event.type === "plan") {
                updatePlaceholder({
                  reasoning: event.reasoning ?? "",
                  todos: event.todos ?? [],
                  completedStepIndices: [],
                  executingStepIndex: undefined,
                  executingToolName: undefined,
                  executingTodoLabel: undefined,
                  executingSubStepLabel: undefined,
                }, true);
              } else if (event.type === "step_start" && event.stepIndex !== undefined) {
                updatePlaceholder({
                  executingStepIndex: event.stepIndex,
                  executingToolName: (event as { toolName?: string }).toolName,
                  executingTodoLabel: (event as { todoLabel?: string }).todoLabel,
                  executingSubStepLabel: (event as { subStepLabel?: string }).subStepLabel,
                }, true);
              } else if (event.type === "todo_done" && event.index !== undefined) {
                flushSync(() =>
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === placeholderId
                        ? {
                            ...m,
                            completedStepIndices: [...(m.completedStepIndices ?? []), event.index!],
                            executingStepIndex: undefined,
                            executingToolName: undefined,
                            executingTodoLabel: undefined,
                            executingSubStepLabel: undefined,
                          }
                        : m
                    )
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
                  executingToolName: undefined,
                  executingTodoLabel: undefined,
                  executingSubStepLabel: undefined,
                  ...(event.rephrasedPrompt !== undefined && { rephrasedPrompt: event.rephrasedPrompt }),
                }, true);
                if (event.messageId) {
                  setMessages((prev) =>
                    prev.map((m) => (m.id === placeholderId ? { ...m, id: event.messageId! } : m))
                  );
                }
                if (event.userMessageId) {
                  setMessages((prev) =>
                    prev.map((m) => (m.id === userMsg.id ? { ...m, id: event.userMessageId! } : m))
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
                if (event.userMessageId) {
                  setMessages((prev) =>
                    prev.map((m) => (m.id === userMsg.id ? { ...m, id: event.userMessageId! } : m))
                  );
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

  const conversationsContent = (
    <>
      <div className="chat-conversations-header">
        <span>Conversations</span>
        <button type="button" className="chat-header-btn" onClick={() => setShowConversationList(false)} title="Close">
          <Minus size={14} />
        </button>
      </div>
      <button type="button" className="chat-new-chat-btn" onClick={startNewChat}>
        <MessageSquarePlus size={16} />
        <span>New chat</span>
      </button>
      <ul className={`chat-conversations-list ${!embedded ? "chat-conversations-modal-list" : ""}`}>
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
      <div className="chat-sidebar-actions">
        <a
          href={conversationId ? `/chat/traces?conversationId=${encodeURIComponent(conversationId)}` : "/chat/traces"}
          target="_blank"
          rel="noopener noreferrer"
          className="chat-sidebar-action-link"
        >
          <GitBranch size={14} />
          Stack traces
        </a>
        {embedded && onOpenSettings && (
          <button type="button" className="chat-sidebar-action-btn" onClick={onOpenSettings} title="Assistant settings">
            <Settings2 size={14} />
            Settings
          </button>
        )}
      </div>
    </>
  );

  const conversationsModal = !embedded && showConversationList && (
    <div className="chat-conversations-modal" role="dialog" aria-label="Chat history">
      <div
        className="chat-conversations-modal-backdrop"
        role="presentation"
        onClick={() => setShowConversationList(false)}
      />
      <div className="chat-conversations-modal-dialog">
        {conversationsContent}
      </div>
    </div>
  );

  const chatMain = (
    <div className={`chat-main ${embedded ? "chat-main-embedded" : ""}`}>
        <div className="chat-header">
          <button
            type="button"
            className="chat-header-btn"
            onClick={() => setShowConversationList((s) => !s)}
            title={showConversationList ? "Close history" : "Chat history"}
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
            onChange={handleProviderChange}
            title="Select an LLM provider (required)"
          >
            <option value="">Select a provider…</option>
            {[...providers]
              .sort((a, b) => a.model.localeCompare(b.model, undefined, { sensitivity: "base" }) || a.provider.localeCompare(b.provider))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.model} ({p.provider})
                </option>
              ))}
          </select>
          {!embedded && (
            <button className="chat-header-btn chat-header-minimize" onClick={onClose} title="Minimize">
              <Minus size={14} />
            </button>
          )}
        </div>

        {attachedContext && (
          <div className="chat-attached-banner">
            Run output attached — ask anything and the assistant will use it to help.
          </div>
        )}

        {/* Messages */}
        <div className="chat-messages" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="chat-empty">
              <div className="chat-empty-icon">
                <BrandIcon size={48} />
              </div>
              <p className="chat-empty-title">How can I help?</p>
              <p className="chat-empty-sub">
                Create agents, write functions, manage sandboxes, and more.
              </p>
              {providers.length === 0 && (
                <p className="chat-empty-sub" style={{ marginTop: "0.5rem" }}>
                  <a href="/settings/llm" className="chat-settings-link">Add an LLM provider</a> in Settings to start chatting.
                </p>
              )}
            </div>
          )}
          {messages.map((msg, index) => {
            const isLastMessage = index === messages.length - 1;
            const hideActionsWhileThinking = loading && isLastMessage && msg.role === "assistant";
            return (
            <div key={msg.id} className={`chat-msg chat-msg-${msg.role}`}>
              {msg.role === "assistant" && msg.rephrasedPrompt != null && msg.rephrasedPrompt.trim() !== "" && (
                <div className="chat-rephrased-prompt">
                  <span className="chat-rephrased-label">Rephrased prompt</span>
                  <p className="chat-rephrased-text">{msg.rephrasedPrompt}</p>
                </div>
              )}
              {msg.role === "assistant" && (msg.traceSteps?.length ?? 0) > 0 && (
                <div className="chat-trace-steps">
                  <span className="chat-trace-step" title={msg.traceSteps![msg.traceSteps!.length - 1].contentPreview ?? undefined}>
                    {loading && isLastMessage && (msg as Message & { executingToolName?: string }).executingToolName === "execute_workflow"
                      ? "Running workflow…"
                      : msg.traceSteps![msg.traceSteps!.length - 1].label ?? msg.traceSteps![msg.traceSteps!.length - 1].phase}
                  </span>
                </div>
              )}
              {msg.role === "assistant" && isLastMessage && loading && (() => {
                const stepIndex = msg.executingStepIndex;
                const todos = msg.todos ?? [];
                const total = todos.length;
                const allDone = total > 0 && (msg.completedStepIndices?.length ?? 0) === total;
                const toolName = (msg as Message & { executingToolName?: string }).executingToolName;
                let status: string;
                if (allDone) {
                  status = "Completing…";
                } else if (toolName) {
                  const subStep = (msg as Message & { executingSubStepLabel?: string }).executingSubStepLabel;
                  const toolLabel = toolName === "execute_workflow" ? "workflow" : toolName;
                  status = subStep ? `${subStep} (${toolLabel})…` : toolName === "execute_workflow" ? "Running workflow…" : `Running ${toolName}…`;
                } else if (stepIndex !== undefined && total > 0 && todos[stepIndex] != null) {
                  status = total > 1 ? `Step ${stepIndex + 1} of ${total}: ${todos[stepIndex]}` : String(todos[stepIndex]);
                } else if (todos.length > 0 || (msg.reasoning != null && String(msg.reasoning).trim() !== "")) {
                  status = "Planning…";
                } else {
                  status = "Thinking…";
                }
                return (
                  <span className="chat-typing-status">
                    <LogoLoading size={20} className="chat-typing-logo" />
                    {status}
                  </span>
                );
              })()}
              {msg.role === "assistant" && msg.reasoning && isLastMessage && (
                <div className="chat-plan">
                  <div className="chat-plan-reasoning">
                    <span className="chat-plan-label">Reasoning</span>
                    <ReasoningContent text={msg.reasoning} />
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
                            {done ? <Check size={12} className="chat-plan-todo-icon" /> : executing ? <Loader size={12} className="chat-plan-todo-icon chat-plan-todo-icon-spin" /> : <Circle size={12} className="chat-plan-todo-icon" />}
                            <span>{todo}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              )}
              {(() => {
                const list = msg.toolResults ?? [];
                const filtered = list.filter((r) => r.name !== "ask_user");
                const displayContent = msg.role === "assistant" ? getAssistantMessageDisplayContent(msg.content, list) : msg.content;
                return (
                  <>
                    {filtered.length > 0 ? <ChatToolResults results={filtered} /> : null}
                    {msg.role === "assistant" && msg.content.startsWith("Error: ") ? (
                      <div className="chat-msg-error-placeholder">
                        <p>An error occurred.</p>
                        <a
                          href={conversationId ? `/chat/traces?conversationId=${encodeURIComponent(conversationId)}` : "/chat/traces"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="chat-view-traces-link"
                        >
                          View stack trace for details <ExternalLink size={12} />
                        </a>
                      </div>
                    ) : displayContent.trim() !== "" ? (
                      <ChatMessageContent content={displayContent} />
                    ) : null}
                  </>
                );
              })()}
              {msg.role === "assistant" && !hideActionsWhileThinking && (
                <div className="chat-msg-actions">
                  <button
                    className="chat-rate-btn"
                    type="button"
                    onClick={async () => {
                      const ok = await copyToClipboard(getMessageCopyText(msg));
                      if (ok) {
                        setCopiedMsgId(msg.id);
                        setTimeout(() => setCopiedMsgId(null), 1500);
                      }
                    }}
                    title="Copy message and tool results"
                  >
                    {copiedMsgId === msg.id ? <Check size={11} /> : <Copy size={11} />}
                  </button>
                  <button className="chat-rate-btn" onClick={() => rateFeedback(msg, "good")} title="Good"><ThumbsUp size={11} /></button>
                  <button className="chat-rate-btn" onClick={() => rateFeedback(msg, "bad")} title="Bad"><ThumbsDown size={11} /></button>
                </div>
              )}
            </div>
          );
          })}
        </div>

        {providers.length === 0 && (
          <div className="chat-no-model-banner">
            No model selected. <a href="/settings/llm" className="chat-settings-link">Add an LLM provider in Settings</a> to send messages.
          </div>
        )}
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
            <button
              className="chat-send-btn"
              onClick={send}
              disabled={!input.trim() || !providerId}
              title={!providerId ? "Select an LLM provider first" : undefined}
            >
              <Send size={14} />
            </button>
          )}
        </div>
        {/* Feedback trigger — always at end of conversation */}
        <div className="chat-feedback-trigger-row">
          <button
            type="button"
            className="chat-feedback-trigger"
            onClick={() => setShowFeedbackModal(true)}
          >
            <Star size={14} />
            Feedback
          </button>
        </div>
    </div>
  );

  return (
    <>
      {open && !embedded && (
        <div
          className="chat-backdrop"
          ref={backdropRef}
          onClick={handleBackdropClick}
        />
      )}
      {conversationsModal}
      {embedded ? (
        <div className="chat-panel chat-panel-open chat-panel-embedded">
          {showConversationList && (
            <div className="chat-conversations-sidebar chat-conversations-sidebar-embedded">
              {conversationsContent}
            </div>
          )}
          {chatMain}
        </div>
      ) : (
        <div className={`chat-panel ${open ? "chat-panel-open" : ""}`}>
          {chatMain}
        </div>
      )}
      {showFeedbackModal && (
        <div className="chat-feedback-modal-portal">
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
