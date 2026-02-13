"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { flushSync } from "react-dom";
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
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { ChatMessageContent, ChatToolResults, getAssistantMessageDisplayContent, ReasoningContent } from "./chat-message-content";
import ChatFeedbackModal from "./chat-feedback-modal";
import LogoLoading from "./logo-loading";

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

type TraceStep = { phase: string; label?: string; contentPreview?: string };

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolResults?: ToolResult[];
  reasoning?: string;
  todos?: string[];
  completedStepIndices?: number[];
  executingStepIndex?: number;
  executingToolName?: string;
  executingTodoLabel?: string;
  executingSubStepLabel?: string;
  rephrasedPrompt?: string | null;
  /** Live trace steps during thinking (e.g. "Rephrasing…", "Calling LLM…"). */
  traceSteps?: TraceStep[];
};

const CHAT_SECTION_STATE_KEY = "agentron-chat-section-state";
const CHAT_SECTION_STATE_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

function loadChatSectionState(conversationId: string): { messages: Message[]; loading: boolean; timestamp: number } | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CHAT_SECTION_STATE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { conversationId: string; messages: Message[]; loading: boolean; timestamp: number };
    if (data.conversationId !== conversationId) return null;
    if (Date.now() - data.timestamp > CHAT_SECTION_STATE_MAX_AGE_MS) return null;
    return { messages: data.messages ?? [], loading: !!data.loading, timestamp: data.timestamp };
  } catch {
    return null;
  }
}

function saveChatSectionState(conversationId: string, messages: Message[], loading: boolean) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      CHAT_SECTION_STATE_KEY,
      JSON.stringify({ conversationId, messages, loading, timestamp: Date.now() })
    );
  } catch {
    // ignore
  }
}

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

type ConversationItem = { id: string; title: string | null; rating: number | null; note: string | null; createdAt: number };
type LlmProvider = { id: string; provider: string; model: string; endpoint?: string };

type PendingHelpRequest = { runId: string; question: string; reason?: string; targetName: string; targetType: string };

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
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [collapsedStepsByMsg, setCollapsedStepsByMsg] = useState<Record<string, boolean>>({});
  const [pendingHelp, setPendingHelp] = useState<{ count: number; requests: PendingHelpRequest[] }>({ count: 0, requests: [] });
  const [respondingToRunId, setRespondingToRunId] = useState<string | null>(null);
  const [pendingReplyByRunId, setPendingReplyByRunId] = useState<Record<string, string>>({});

  const CHAT_DEFAULT_PROVIDER_KEY = "chat-default-provider-id";
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

  const fetchConversationList = useCallback(() => {
    fetch("/api/chat/conversations")
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setConversationList(list);
        setConversationId((current) => {
          if (!current && list.length > 0) return list[0].id;
          return current;
        });
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  useEffect(() => {
    fetchConversationList();
  }, [fetchConversationList]);

  // Refetch list when user returns to the tab so conversations started in the FAB are visible
  useEffect(() => {
    const onFocus = () => fetchConversationList();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchConversationList]);

  // Load messages when conversation changes; restore from sessionStorage if we have recent state (e.g. user returned while thinking)
  useEffect(() => {
    if (!conversationId) return;
    const restored = loadChatSectionState(conversationId);
    if (restored) {
      setMessages(restored.messages);
      // If the saved state was loading and is recent (within 90s), treat it as in-flight so the user
      // sees the thinking indicator; otherwise assume idle.
      const isFresh = Date.now() - restored.timestamp <= 90_000;
      setLoading(restored.loading && isFresh);
      setLoaded(true);
      // Background fetch: if response completed while away, use API state
      fetch(`/api/chat?conversationId=${encodeURIComponent(conversationId)}`)
        .then((r) => r.json())
        .then((data) => {
          if (!Array.isArray(data)) return;
          const apiMessages = data.map((m: Record<string, unknown>) => ({
            id: m.id as string,
            role: m.role as "user" | "assistant",
            content: m.content as string,
            toolResults: m.toolCalls as ToolResult[] | undefined,
          })) as Message[];
          if (!restored.loading) return;
          const useApi = apiMessages.length > restored.messages.length
            || (apiMessages.length > 0 && restored.messages.length > 0
                && (apiMessages[apiMessages.length - 1] as Message).role === "assistant"
                && (apiMessages[apiMessages.length - 1] as Message).content.trim()
                && !(restored.messages[restored.messages.length - 1] as Message).content.trim());
          if (useApi) {
            setMessages(apiMessages);
            setLoading(false);
          }
        })
        .catch(() => {});
      return;
    }
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

  // Persist messages and loading so returning to the page restores thinking state
  useEffect(() => {
    if (!conversationId || !loaded) return;
    saveChatSectionState(conversationId, messages, loading);
  }, [conversationId, loaded, messages, loading]);

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

  const fetchPendingHelp = useCallback(() => {
    fetch("/api/runs/pending-help")
      .then((r) => r.json())
      .then((data) => {
        const count = typeof data.count === "number" ? data.count : 0;
        const requests = Array.isArray(data.requests) ? data.requests as PendingHelpRequest[] : [];
        setPendingHelp({ count, requests });
      })
      .catch(() => setPendingHelp({ count: 0, requests: [] }));
  }, []);

  useEffect(() => {
    fetchPendingHelp();
    const interval = setInterval(fetchPendingHelp, 8000);
    return () => clearInterval(interval);
  }, [fetchPendingHelp]);

  useEffect(() => {
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
  }, []);

  const handleProviderChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setProviderId(value);
    if (typeof localStorage !== "undefined" && value) localStorage.setItem(CHAT_DEFAULT_PROVIDER_KEY, value);
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
    const userMsg: Message = { id: randomId(), role: "user", content: text };
    const placeholderId = randomId();
    const placeholderMsg: Message = { id: placeholderId, role: "assistant", content: "" };
    setMessages((prev) => [...prev, userMsg, placeholderMsg]);
    setLoading(true);
    abortRef.current = new AbortController();
    const updatePlaceholder = (updates: Partial<Message>, flush = false) => {
      const updater = () => setMessages((prev) => prev.map((m) => (m.id === placeholderId ? { ...m, ...updates } : m)));
      if (flush) flushSync(updater);
      else updater();
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
                userMessageId?: string;
                conversationId?: string;
                conversationTitle?: string;
                rephrasedPrompt?: string;
                completedStepIndices?: number[];
                error?: string;
                phase?: string;
                label?: string;
                contentPreview?: string;
              };
              if (event.type === "trace_step") {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === placeholderId
                      ? { ...m, traceSteps: [...(m.traceSteps ?? []), { phase: event.phase ?? "", label: event.label, contentPreview: event.contentPreview }] }
                      : m
                  )
                );
              } else if (event.type === "rephrased_prompt" && event.rephrasedPrompt != null) updatePlaceholder({ rephrasedPrompt: event.rephrasedPrompt });
              else if (event.type === "plan") updatePlaceholder({ reasoning: event.reasoning ?? "", todos: event.todos ?? [], completedStepIndices: [], executingStepIndex: undefined, executingToolName: undefined, executingTodoLabel: undefined, executingSubStepLabel: undefined }, true);
              else if (event.type === "step_start" && event.stepIndex !== undefined) updatePlaceholder({
                executingStepIndex: event.stepIndex,
                executingToolName: (event as { toolName?: string }).toolName,
                executingTodoLabel: (event as { todoLabel?: string }).todoLabel,
                executingSubStepLabel: (event as { subStepLabel?: string }).subStepLabel,
              }, true);
              else if (event.type === "todo_done" && event.index !== undefined) {
                flushSync(() =>
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === placeholderId ? { ...m, completedStepIndices: [...(m.completedStepIndices ?? []), event.index!], executingStepIndex: undefined, executingToolName: undefined, executingTodoLabel: undefined, executingSubStepLabel: undefined } : m
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
                if (event.messageId) setMessages((prev) => prev.map((m) => (m.id === placeholderId ? { ...m, id: event.messageId! } : m)));
                if (event.userMessageId) setMessages((prev) => prev.map((m) => (m.id === userMsg.id ? { ...m, id: event.userMessageId! } : m)));
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
                if (event.userMessageId) setMessages((prev) => prev.map((m) => (m.id === userMsg.id ? { ...m, id: event.userMessageId! } : m)));
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

  const handleRespondToRun = useCallback(
    async (runId: string, response: string) => {
      if (!response.trim()) return;
      setRespondingToRunId(runId);
      try {
        const res = await fetch(`/api/runs/${runId}/respond`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response: response.trim() }),
        });
        if (res.ok) {
          fetchPendingHelp();
        }
      } finally {
        setRespondingToRunId(null);
      }
    },
    [fetchPendingHelp]
  );

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
            onChange={handleProviderChange}
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
          {pendingHelp.requests.length > 0 && (
            <div className="chat-section-pending-help">
              <div className="chat-section-pending-help-title">Agent needs your input</div>
              <p className="chat-section-pending-help-sub">Respond here to unblock the run. Your reply is sent to the agent.</p>
              {pendingHelp.requests.map((req) => (
                <div key={req.runId} className="chat-section-pending-help-card">
                  <div className="chat-section-pending-help-card-header">
                    <span className="chat-section-pending-help-card-target">{req.targetName || req.targetType}</span>
                    <a href={`/runs/${req.runId}`} target="_blank" rel="noopener noreferrer" className="chat-section-pending-help-card-link">View run</a>
                  </div>
                  <p className="chat-section-pending-help-card-question">{req.question}</p>
                  {req.reason && <p className="chat-section-pending-help-card-reason">{req.reason}</p>}
                  <div className="chat-section-pending-help-card-reply">
                    <input
                      type="text"
                      className="chat-section-input"
                      placeholder="Your response…"
                      value={pendingReplyByRunId[req.runId] ?? ""}
                      onChange={(e) => setPendingReplyByRunId((prev) => ({ ...prev, [req.runId]: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && handleRespondToRun(req.runId, pendingReplyByRunId[req.runId] ?? "")}
                      disabled={respondingToRunId === req.runId}
                    />
                    <button
                      type="button"
                      className="chat-section-send"
                      disabled={!(pendingReplyByRunId[req.runId] ?? "").trim() || respondingToRunId === req.runId}
                      onClick={() => {
                        const text = pendingReplyByRunId[req.runId] ?? "";
                        handleRespondToRun(req.runId, text);
                        setPendingReplyByRunId((prev) => ({ ...prev, [req.runId]: "" }));
                      }}
                      title="Send response to agent"
                    >
                      {respondingToRunId === req.runId ? <Loader size={18} className="spin" /> : <Send size={18} />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!loaded ? (
            <div className="chat-section-loading">Loading…</div>
          ) : messages.length === 0 ? (
            <div className="chat-section-welcome">
              <div className="chat-section-welcome-icon">AI</div>
              <h2 className="chat-section-welcome-title">How can I help?</h2>
              <p className="chat-section-welcome-sub">Ask anything about agents, workflows, and tools.</p>
              {providers.length === 0 && (
                <p className="chat-section-welcome-sub" style={{ marginTop: "0.5rem" }}>
                  <a href="/settings/llm" className="chat-section-settings-link">Add an LLM provider</a> in Settings to start chatting.
                </p>
              )}
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
                    {msg.role === "assistant" && (msg.traceSteps?.length ?? 0) > 0 && (
                      <div className="chat-section-trace-steps">
                        <span className="chat-section-trace-step" title={msg.traceSteps![msg.traceSteps!.length - 1].contentPreview ?? undefined}>
                          {loading && isLast && msg.executingToolName === "execute_workflow"
                            ? "Running workflow…"
                            : msg.traceSteps![msg.traceSteps!.length - 1].label ?? msg.traceSteps![msg.traceSteps!.length - 1].phase}
                        </span>
                      </div>
                    )}
                    {msg.role === "assistant" && isLast && loading && (
                      <span className="chat-section-typing">
                        <LogoLoading size={20} className="chat-section-typing-logo" />
                        {msg.todos?.length
                          ? (msg.completedStepIndices?.length === msg.todos.length
                              ? "Completing…"
                              : msg.executingToolName
                                ? (msg.executingSubStepLabel ? `${msg.executingSubStepLabel} (${msg.executingToolName === "execute_workflow" ? "workflow" : msg.executingToolName})…` : msg.executingToolName === "execute_workflow" ? "Running workflow…" : `Running ${msg.executingToolName}…`)
                                : `Step ${(msg.executingStepIndex ?? 0) + 1} of ${msg.todos.length}`)
                          : "Thinking…"}
                      </span>
                    )}
                    {msg.role === "assistant" && msg.reasoning && isLast && (
                      <div className="chat-section-plan">
                        <span className="chat-section-plan-label">Reasoning</span>
                        <ReasoningContent text={msg.reasoning} />
                      </div>
                    )}
                    {msg.role === "assistant" && msg.todos && msg.todos.length > 0 && (
                      <div className="chat-section-todos-wrap">
                        {(() => {
                          const allDone =
                            msg.completedStepIndices &&
                            msg.completedStepIndices.length >= msg.todos!.length;
                          const collapsed =
                            collapsedStepsByMsg[msg.id] ?? !!allDone;
                          const toggle = () =>
                            setCollapsedStepsByMsg((prev) => ({
                              ...prev,
                              [msg.id]: !collapsed,
                            }));
                          return (
                            <>
                              <button
                                type="button"
                                onClick={toggle}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  width: "100%",
                                  background: "transparent",
                                  border: "none",
                                  padding: 0,
                                  margin: 0,
                                  cursor: "pointer",
                                  font: "inherit",
                                }}
                              >
                                <span className="chat-section-todos-label">
                                  Steps
                                </span>
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                    fontSize: "0.78rem",
                                    color: "var(--text-muted)",
                                  }}
                                >
                                  {allDone ? "Done" : "In progress"}
                                  {collapsed ? (
                                    <ChevronRight size={12} />
                                  ) : (
                                    <ChevronDown size={12} />
                                  )}
                                </span>
                              </button>
                              {!collapsed && (
                                <ul className="chat-section-todos">
                                  {msg.todos.map((todo, i) => (
                                    <li
                                      key={i}
                                      className={
                                        msg.completedStepIndices?.includes(i)
                                          ? "done"
                                          : msg.executingStepIndex === i
                                          ? "active"
                                          : ""
                                      }
                                    >
                                      <span className="chat-section-todo-icon">
                                        {msg.completedStepIndices?.includes(
                                          i
                                        ) ? (
                                          <Check size={12} />
                                        ) : msg.executingStepIndex === i ? (
                                          <Loader
                                            size={12}
                                            className="spin"
                                          />
                                        ) : (
                                          <Circle size={12} />
                                        )}
                                      </span>
                                      <span className="chat-section-todo-text">
                                        {todo}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </>
                          );
                        })()}
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
                            <div className="chat-section-error">
                              <p>Something went wrong.</p>
                              <a href={conversationId ? `/chat/traces?conversationId=${encodeURIComponent(conversationId)}` : "/chat/traces"} target="_blank" rel="noopener noreferrer">
                                View stack trace <ExternalLink size={12} />
                              </a>
                            </div>
                          ) : displayContent.trim() !== "" ? (
                            <ChatMessageContent content={displayContent} />
                          ) : null}
                        </>
                      );
                    })()}
                    {msg.role === "assistant" && !hideActions && (
                      <div className="chat-section-msg-actions">
                        <button
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
                          {copiedMsgId === msg.id ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                        <button type="button" onClick={() => rateFeedback(msg, "good")} title="Good"><ThumbsUp size={14} /></button>
                        <button type="button" onClick={() => rateFeedback(msg, "bad")} title="Bad"><ThumbsDown size={14} /></button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {providers.length === 0 && (
          <div className="chat-section-no-model-banner">
            No model selected. <a href="/settings/llm" className="chat-section-settings-link">Add an LLM provider in Settings</a> to send messages.
          </div>
        )}
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
