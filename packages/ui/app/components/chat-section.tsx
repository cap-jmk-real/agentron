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
  CircleDot,
  ThumbsUp,
  ThumbsDown,
  Star,
  ChevronDown,
  ChevronRight,
  RotateCw,
} from "lucide-react";
import { ChatMessageContent, ChatMessageResourceLinks, ChatToolResults, getAssistantMessageDisplayContent, getLoadingStatus, getMessageDisplayState, getSuggestedOptions, getSuggestedOptionsFromToolResults, hasAskUserWaitingForInput, messageContentIndicatesSuccess, messageHasSuccessfulToolResults, normalizeToolResults, ReasoningContent } from "./chat-message-content";
import { performChatStreamSend } from "../hooks/useChatStream";
import { useMinimumStepsDisplayTime, MIN_STEPS_DISPLAY_MS } from "../hooks/useMinimumStepsDisplayTime";
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

type InteractivePrompt = { question: string; options?: string[] };

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolResults?: ToolResult[];
  /** Explicit turn status from done event; avoids inferring from toolResults. */
  status?: "completed" | "waiting_for_input";
  /** Interactive prompt from done event when status === "waiting_for_input". */
  interactivePrompt?: InteractivePrompt;
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
const CHAT_DRAFTS_KEY = "agentron-chat-drafts";

function loadDrafts(): Record<string, string> {
  if (typeof sessionStorage === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(CHAT_DRAFTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return typeof parsed === "object" && parsed !== null
      ? (Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === "string")) as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

function getDraft(conversationId: string): string {
  return loadDrafts()[conversationId] ?? "";
}

function setDraft(conversationId: string, text: string) {
  if (typeof sessionStorage === "undefined") return;
  try {
    const drafts = loadDrafts();
    if (text.trim()) drafts[conversationId] = text;
    else delete drafts[conversationId];
    sessionStorage.setItem(CHAT_DRAFTS_KEY, JSON.stringify(drafts));
  } catch {
    /* ignore */
  }
}

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

type Props = {
  onOpenSettings?: () => void;
};

type ChatSectionMessageRowProps = {
  msg: Message;
  index: number;
  messages: Message[];
  loading: boolean;
  collapsedStepsByMsg: Record<string, boolean>;
  setCollapsedStepsByMsg: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  copiedMsgId: string | null;
  setCopiedMsgId: (id: string | null) => void;
  rateFeedback: (msg: Message, rating: "good" | "bad") => void;
  send: (value: string) => void;
  providerId: string;
  conversationId: string | null;
  getMessageCopyText: (msg: Message) => string;
  onShellCommandApprove?: (command: string) => void;
  onShellCommandAddToAllowlist?: (command: string) => void;
  shellCommandLoading?: boolean;
};

function ChatSectionMessageRow({
  msg,
  index,
  messages,
  loading,
  collapsedStepsByMsg,
  setCollapsedStepsByMsg,
  copiedMsgId,
  setCopiedMsgId,
  rateFeedback,
  send,
  providerId,
  conversationId,
  getMessageCopyText,
  onShellCommandApprove,
  onShellCommandAddToAllowlist,
  shellCommandLoading = false,
}: ChatSectionMessageRowProps) {
  const isLast = index === messages.length - 1;
  const hideActions = loading && isLast && msg.role === "assistant";
  const list = msg.toolResults ?? [];
  const displayState = getMessageDisplayState(msg, { isLast, loading });
  const effectiveHasFinalResponseContent = useMinimumStepsDisplayTime(
    msg.id,
    displayState.hasFinalResponseContent,
    MIN_STEPS_DISPLAY_MS
  );
  const FeedbackActions = msg.role === "assistant" && !hideActions ? (
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
  ) : null;
  return (
    <div className={`chat-section-msg chat-section-msg-${msg.role}`}>
      {msg.role === "assistant" && msg.rephrasedPrompt != null && msg.rephrasedPrompt.trim() !== "" && (
        <div className="chat-section-rephrased">
          <span className="chat-section-rephrased-label">Rephrased</span>
          <p className="chat-section-rephrased-text">{msg.rephrasedPrompt}</p>
        </div>
      )}
      {msg.role === "assistant" && (msg.traceSteps?.length ?? 0) > 0 && !effectiveHasFinalResponseContent && !(loading && isLast) && (
        <div className="chat-section-trace-steps">
          <span className="chat-section-trace-step" title={msg.traceSteps![msg.traceSteps!.length - 1].contentPreview ?? undefined}>
            {msg.traceSteps![msg.traceSteps!.length - 1].label ?? msg.traceSteps![msg.traceSteps!.length - 1].phase}
          </span>
        </div>
      )}
      {msg.role === "assistant" && msg.reasoning && isLast && !effectiveHasFinalResponseContent && (
        <div className="chat-section-plan">
          <span className="chat-section-plan-label">Reasoning</span>
          <ReasoningContent text={msg.reasoning} />
        </div>
      )}
      {msg.role === "assistant" && msg.todos && msg.todos.length > 0 && !effectiveHasFinalResponseContent && (
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
        const filtered = list.filter((r) => r.name !== "ask_user" && r.name !== "ask_credentials" && r.name !== "format_response");
        const hasAnyToolResults = Array.isArray(list) && list.length > 0;
        const lastAssistantIndex = messages.map((m, i) => (m.role === "assistant" ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
        const isLastAssistantMessage = msg.role === "assistant" && index === lastAssistantIndex;
        const showError = isLastAssistantMessage && msg.content.startsWith("Error: ") && !displayState.hasAskUserWaiting && !hasAnyToolResults && !messageHasSuccessfulToolResults(list) && !messageContentIndicatesSuccess(msg.content);
        const lastUserMessage = index > 0 && messages[index - 1]?.role === "user" ? messages[index - 1]!.content : "";
        return (
          <>
            {showError ? (
              <div className="chat-section-error">
                <p>Something went wrong.</p>
                <div className="chat-section-error-actions">
                  {lastUserMessage.trim() ? (
                    <button
                      type="button"
                      className="chat-section-error-retry"
                      onClick={() => send(lastUserMessage)}
                      disabled={loading || !providerId}
                      title={!providerId ? "Select an LLM provider first" : "Retry the last message"}
                    >
                      <RotateCw size={14} />
                      Retry
                    </button>
                  ) : null}
                  <a href={conversationId ? `/chat/traces?conversationId=${encodeURIComponent(conversationId)}` : "/chat/traces"} target="_blank" rel="noopener noreferrer">
                    View stack trace <ExternalLink size={12} />
                  </a>
                </div>
              </div>
            ) : (displayState.displayContent.trim() !== "" || displayState.structuredContent) ? (
              <>
                <ChatMessageContent content={displayState.displayContent} structuredContent={displayState.structuredContent} />
                {displayState.hasAskUserWaiting && isLast && !loading && (() => {
                  const opts = msg.interactivePrompt?.options && msg.interactivePrompt.options.length > 0
                    ? msg.interactivePrompt.options.map((s) => ({ value: s, label: s }))
                    : getSuggestedOptionsFromToolResults(list, displayState.displayContent || "");
                  if (opts.length === 0) return null;
                  return (
                    <div className="chat-inline-options" role="group" aria-label="Choose an option">
                      <span className="chat-inline-options-label">Choose an option:</span>
                      <ul className="chat-inline-options-list">
                        {opts.map((opt) => (
                          <li key={opt.value}>
                            <button type="button" className="chat-inline-option-btn" onClick={() => send(opt.value)} disabled={!providerId} title={opt.label !== opt.value ? `Send "${opt.value}"` : undefined}>
                              {opt.label}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}
              </>
            ) : null}
            {list.length > 0 ? <ChatMessageResourceLinks results={list} /> : null}
            {filtered.length > 0 ? (
              <ChatToolResults
                results={filtered}
                onShellCommandApprove={onShellCommandApprove}
                onShellCommandAddToAllowlist={onShellCommandAddToAllowlist}
                shellCommandLoading={shellCommandLoading}
              />
            ) : null}
          </>
        );
      })()}
      {FeedbackActions}
    </div>
  );
}

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
  const [runFinishedNotification, setRunFinishedNotification] = useState<{ runId: string; status: string } | null>(null);
  const [shellCommandLoading, setShellCommandLoading] = useState(false);
  const [pendingInputIds, setPendingInputIds] = useState<Set<string>>(new Set());

  const CHAT_DEFAULT_PROVIDER_KEY = "chat-default-provider-id";
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const prevConversationIdRef = useRef<string | null>(null);

  const resizeInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    resizeInput();
  }, [input, resizeInput]);

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

  useEffect(() => {
    const fetchPending = () => {
      fetch("/api/chat/pending-input")
        .then((r) => r.json())
        .then((d) => {
          const list = Array.isArray(d.conversations) ? d.conversations : [];
          setPendingInputIds(new Set(list.map((c: { conversationId: string }) => c.conversationId)));
        })
        .catch(() => setPendingInputIds(new Set()));
    };
    fetchPending();
    const interval = setInterval(fetchPending, 5000);
    return () => clearInterval(interval);
  }, []);

  // Per-conversation input drafts: save when switching away, load when switching to a conversation
  useEffect(() => {
    const prev = prevConversationIdRef.current;
    if (prev) setDraft(prev, input);
    prevConversationIdRef.current = conversationId;
    if (conversationId) setInput(getDraft(conversationId));
  }, [conversationId]);

  // Save draft on page unload so refresh/navigation preserves it
  useEffect(() => {
    const onBeforeUnload = () => {
      if (conversationId && input.trim()) setDraft(conversationId, input);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [conversationId, input]);

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
          const apiMessages = data.map((m: Record<string, unknown>) => {
            const raw = m.toolCalls;
            const toolResults = (Array.isArray(raw) ? normalizeToolResults(raw) : undefined) as ToolResult[] | undefined;
            return {
              id: m.id as string,
              role: m.role as "user" | "assistant",
              content: m.content as string,
              toolResults,
              ...(m.status !== undefined && { status: m.status as "completed" | "waiting_for_input" }),
              ...(m.interactivePrompt != null && { interactivePrompt: m.interactivePrompt as InteractivePrompt }),
              ...(m.todos != null && { todos: m.todos as string[] }),
              ...(m.completedStepIndices != null && { completedStepIndices: m.completedStepIndices as number[] }),
            } as Message;
          });
          // API is canonical: use when it has more messages, or when restored was loading and API has completed response
          const useApi = apiMessages.length > restored.messages.length
            || (restored.loading && apiMessages.length > 0 && restored.messages.length > 0
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
          setMessages(data.map((m: Record<string, unknown>) => {
            const raw = m.toolCalls;
            const toolResults = (Array.isArray(raw) ? normalizeToolResults(raw) : undefined) as ToolResult[] | undefined;
            return {
              id: m.id as string,
              role: m.role as "user" | "assistant",
              content: m.content as string,
              toolResults,
              ...(m.status !== undefined && { status: m.status as "completed" | "waiting_for_input" }),
              ...(m.interactivePrompt != null && { interactivePrompt: m.interactivePrompt as InteractivePrompt }),
              ...(m.todos != null && { todos: m.todos as string[] }),
              ...(m.completedStepIndices != null && { completedStepIndices: m.completedStepIndices as number[] }),
            } as Message;
          }));
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

  useEffect(() => {
    if (!runFinishedNotification) return;
    const t = setTimeout(() => setRunFinishedNotification(null), 15_000);
    return () => clearTimeout(t);
  }, [runFinishedNotification]);

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

  const lastMsg = messages[messages.length - 1];
  const lastTraceSteps = lastMsg?.role === "assistant" ? lastMsg.traceSteps : undefined;
  useEffect(() => {
    if (loading && lastMsg?.role === "assistant") {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [loading, lastTraceSteps, lastMsg?.role]);

  const stopRequest = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(async (textOverride?: string, extraBody?: Record<string, unknown>) => {
    const text = textOverride !== undefined ? textOverride : input.trim();
    if (!text || loading) return;
    setRunFinishedNotification(null);
    if (textOverride === undefined && !extraBody?.continueShellApproval) {
      setInput("");
      if (conversationId) setDraft(conversationId, "");
    }
    const userMsg: Message = { id: randomId(), role: "user", content: text };
    const placeholderId = randomId();
    setMessages((prev) => [...prev, userMsg, { id: placeholderId, role: "assistant", content: "" }]);
    setLoading(true);
    abortRef.current = new AbortController();
    await performChatStreamSend({
      text,
      messages,
      placeholderId,
      userMsgId: userMsg.id,
      conversationId,
      providerId,
      uiContext: getUiContext(pathname),
      setMessages,
      setConversationId,
      setConversationList,
      setLoading,
      abortSignal: abortRef.current?.signal,
      randomId,
      normalizeToolResults,
      buildBody: (base) => base,
      extraBody,
      onRunFinished: (runId, status) => {
        setRunFinishedNotification({ runId, status });
        if (status === "waiting_for_user" && conversationId) {
          fetch(`/api/chat?conversationId=${encodeURIComponent(conversationId)}`)
            .then((r) => r.json())
            .then((data) => {
              if (!Array.isArray(data)) return;
              setMessages(data.map((m: Record<string, unknown>) => {
                const raw = m.toolCalls;
                const toolResults = (Array.isArray(raw) ? normalizeToolResults(raw) : undefined) as ToolResult[] | undefined;
                return {
                  id: m.id as string,
                  role: m.role as "user" | "assistant",
                  content: m.content as string,
                  toolResults,
                  ...(m.status !== undefined && { status: m.status as "completed" | "waiting_for_input" }),
                  ...(m.interactivePrompt != null && { interactivePrompt: m.interactivePrompt as InteractivePrompt }),
                  ...(m.todos != null && { todos: m.todos as string[] }),
                  ...(m.completedStepIndices != null && { completedStepIndices: m.completedStepIndices as number[] }),
                } as Message;
              }));
            })
            .catch(() => {});
        }
      },
      onAbort: () => { abortRef.current = null; },
      onInputRestore: (t) => setInput(t),
    });
    abortRef.current = null;
  }, [input, loading, messages, providerId, conversationId, pathname]);

  const handleShellCommandApprove = useCallback(async (command: string) => {
    if (shellCommandLoading || loading) return;
    setShellCommandLoading(true);
    try {
      const res = await fetch("/api/shell-command/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = data.error || "Command failed";
        send(`The shell command failed: ${err}`);
        return;
      }
      const stdout = (data.stdout ?? "").trim();
      const stderr = (data.stderr ?? "").trim();
      const exitCode = data.exitCode;
      send("Command approved and run.", {
        continueShellApproval: { command, stdout, stderr, exitCode },
      });
    } catch {
      send("Failed to execute the shell command.");
    } finally {
      setShellCommandLoading(false);
    }
  }, [shellCommandLoading, loading, send]);

  const handleShellCommandAddToAllowlist = useCallback(async (command: string) => {
    if (shellCommandLoading) return;
    setShellCommandLoading(true);
    try {
      const res = await fetch("/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addShellCommand: command }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const added = (data.addedCommands as string[] | undefined) ?? [command];
        const msg = added.length > 1
          ? `Added ${added.length} commands to the allowlist. You can run them again; they will execute without approval next time.`
          : `Added "${added[0] ?? command}" to the allowlist. You can run it again; it will execute without approval next time.`;
        send(msg);
      } else {
        send(`Failed to add to allowlist: ${data.error || "Unknown error"}`);
      }
    } catch {
      send("Failed to add command to allowlist.");
    } finally {
      setShellCommandLoading(false);
    }
  }, [shellCommandLoading, send]);

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
            {conversationList.map((c) => {
              const isCurrent = c.id === conversationId;
              const status = isCurrent
                ? loading
                  ? "running"
                  : messages.length === 0
                    ? null
                    : (() => {
                        const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
                        return lastAssistant && hasAskUserWaitingForInput(lastAssistant.toolResults) ? "waiting" : "finished";
                      })()
                : pendingInputIds.has(c.id)
                  ? "waiting"
                  : null;
              return (
              <li key={c.id} className="chat-section-conv-item">
                <button
                  type="button"
                  className={`chat-section-conv-btn ${isCurrent ? "active" : ""}`}
                  onClick={() => setConversationId(c.id)}
                >
                  {status && (
                    <span className={`chat-section-conv-status chat-section-conv-status-${status}`} title={status === "running" ? "Running" : status === "waiting" ? "Waiting for input" : "Finished"}>
                      {status === "finished" && <Check size={12} />}
                      {status === "running" && <Loader size={12} className="chat-conv-status-loader" />}
                      {status === "waiting" && <CircleDot size={12} />}
                    </span>
                  )}
                  <span className="chat-section-conv-title">{(c.title && c.title.trim()) ? c.title.trim() : "New chat"}</span>
                </button>
                <button type="button" className="chat-section-conv-delete" onClick={(e) => deleteConversation(c.id, e)} title="Delete" aria-label="Delete">
                  <Trash2 size={14} />
                </button>
              </li>
            );
            })}
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
          {!loaded ? (
            <div className="chat-section-loading">Loading…</div>
          ) : messages.length === 0 ? (
            <div className="chat-section-welcome">
              <div className="chat-section-welcome-icon">
                <BrandIcon size={64} />
              </div>
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
              {messages.map((msg, index) => (
                <ChatSectionMessageRow
                  key={msg.id}
                  msg={msg}
                  index={index}
                  messages={messages}
                  loading={loading}
                  collapsedStepsByMsg={collapsedStepsByMsg}
                  setCollapsedStepsByMsg={setCollapsedStepsByMsg}
                  copiedMsgId={copiedMsgId}
                  setCopiedMsgId={setCopiedMsgId}
                  rateFeedback={rateFeedback}
                  send={send}
                  providerId={providerId}
                  conversationId={conversationId}
                  getMessageCopyText={getMessageCopyText}
                  onShellCommandApprove={handleShellCommandApprove}
                  onShellCommandAddToAllowlist={handleShellCommandAddToAllowlist}
                  shellCommandLoading={shellCommandLoading}
                />
              ))}
            </div>
          )}
        </div>

        {loaded && messages.length > 0 && loading && lastMsg?.role === "assistant" && (() => {
          const status = getLoadingStatus(lastMsg as Message & { traceSteps?: { phase: string; label?: string }[]; todos?: string[]; completedStepIndices?: number[]; executingStepIndex?: number; executingToolName?: string; executingSubStepLabel?: string; reasoning?: string });
          return (
            <div className="chat-section-status-bar" aria-live="polite">
              <LogoLoading size={18} className="chat-section-status-bar-logo" />
              <span>{status}</span>
            </div>
          );
        })()}

        {providers.length === 0 && (
          <div className="chat-section-no-model-banner">
            No model selected. <a href="/settings/llm" className="chat-section-settings-link">Add an LLM provider in Settings</a> to send messages.
          </div>
        )}
        {runFinishedNotification && !loading && (
          <div className="chat-section-run-finished-toast">
            <span>
              {runFinishedNotification.status === "waiting_for_user"
                ? "The agent is waiting for your input. Send a message below to respond."
                : "Workflow run finished. The agent may need your input."}
            </span>
            <a href={`/runs/${runFinishedNotification.runId}`} target="_blank" rel="noopener noreferrer" className="chat-section-run-finished-link">
              View run
            </a>
            <button type="button" className="chat-section-run-finished-dismiss" onClick={() => setRunFinishedNotification(null)} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}
        <div className="chat-section-input-wrap">
          <div className="chat-section-input-inner">
            <textarea
              ref={inputRef}
              className="chat-section-input chat-section-input-textarea"
              placeholder="Message Agentron… (Shift+Enter for new line)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              onInput={resizeInput}
              rows={1}
              disabled={loading}
            />
            {loading ? (
              <button type="button" className="chat-section-send" onClick={stopRequest} title="Stop"><Square size={18} fill="currentColor" /></button>
            ) : (
              <button
                type="button"
                className="chat-section-send"
                onClick={() => void send()}
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
