"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Send, ThumbsUp, ThumbsDown, Loader, Minus, Copy, Check, Circle, CircleDot, Square, MessageSquarePlus, List, Star, Trash2, ExternalLink, GitBranch, Settings2, KeyRound, Lock, Unlock, RotateCw } from "lucide-react";
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

type ChatModalMessageRowProps = {
  msg: Message;
  index: number;
  messages: Message[];
  loading: boolean;
  copiedMsgId: string | null;
  setCopiedMsgId: (id: string | null) => void;
  rateFeedback: (msg: Message, rating: "good" | "bad") => void;
  send: (payload?: unknown, optionValue?: string) => void | Promise<void>;
  providerId: string;
  conversationId: string | null;
  getMessageCopyText: (msg: Message) => string;
  onShellCommandApprove?: (command: string) => void;
  onShellCommandAddToAllowlist?: (command: string) => void;
  shellCommandLoading?: boolean;
};

function ChatModalMessageRow({
  msg,
  index,
  messages,
  loading,
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
}: ChatModalMessageRowProps) {
  const isLastMessage = index === messages.length - 1;
  const hideActionsWhileThinking = loading && isLastMessage && msg.role === "assistant";
  const list = msg.toolResults ?? [];
  const displayState = getMessageDisplayState(msg, { isLast: isLastMessage, loading });
  const effectiveHasFinalResponseContent = useMinimumStepsDisplayTime(
    msg.id,
    displayState.hasFinalResponseContent,
    MIN_STEPS_DISPLAY_MS
  );
  if (displayState.isEmptyPlaceholder) return null;
  const FeedbackActions = msg.role === "assistant" && !hideActionsWhileThinking ? (
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
  ) : null;
  return (
    <div className={`chat-msg chat-msg-${msg.role}`}>
      {msg.role === "assistant" && isLastMessage && (msg.todos?.length ?? 0) > 0 && !effectiveHasFinalResponseContent && (
        <div className="chat-steps-panel" aria-label="Current steps">
          <span className="chat-steps-panel-title">Steps</span>
          <ul className="chat-steps-list">
            {msg.todos!.map((todo, i) => {
              const done = msg.completedStepIndices?.includes(i) === true;
              const executing = msg.executingStepIndex === i;
              return (
                <li
                  key={i}
                  className={`chat-steps-item ${done ? "chat-steps-item-done" : ""} ${executing ? "chat-steps-item-executing" : ""}`}
                >
                  {done ? (
                    <Check size={14} className="chat-steps-icon chat-steps-icon-done" aria-hidden />
                  ) : executing ? (
                    <Loader size={14} className="chat-steps-icon chat-steps-icon-spin" aria-hidden />
                  ) : (
                    <Circle size={14} className="chat-steps-icon chat-steps-icon-open" aria-hidden />
                  )}
                  <span className="chat-steps-label">{todo}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {msg.role === "assistant" && msg.rephrasedPrompt != null && msg.rephrasedPrompt.trim() !== "" && (
        <div className="chat-rephrased-prompt">
          <span className="chat-rephrased-label">Rephrased prompt</span>
          <p className="chat-rephrased-text">{msg.rephrasedPrompt}</p>
        </div>
      )}
      {msg.role === "assistant" && (msg.traceSteps?.length ?? 0) > 0 && !effectiveHasFinalResponseContent && (
        <div className="chat-trace-steps" aria-label="Current step">
          <span className="chat-trace-step" title={msg.traceSteps![msg.traceSteps!.length - 1].contentPreview ?? undefined}>
            {msg.traceSteps![msg.traceSteps!.length - 1].label ?? msg.traceSteps![msg.traceSteps!.length - 1].phase}
          </span>
        </div>
      )}
      {msg.role === "assistant" && msg.reasoning && isLastMessage && !effectiveHasFinalResponseContent && (
        <div className="chat-plan">
          <div className="chat-plan-reasoning">
            <span className="chat-plan-label">Reasoning</span>
            <ReasoningContent text={msg.reasoning} />
          </div>
        </div>
      )}
      {(() => {
        const hasAnyToolResults = Array.isArray(list) && list.length > 0;
        const lastAssistantIndex = messages.map((m, i) => (m.role === "assistant" ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
        const isLastAssistantMessage = msg.role === "assistant" && index === lastAssistantIndex;
        const showError = isLastAssistantMessage && msg.content.startsWith("Error: ") && !displayState.hasAskUserWaiting && !hasAnyToolResults && !messageHasSuccessfulToolResults(list) && !messageContentIndicatesSuccess(msg.content);
        const lastUserMessage = index > 0 && messages[index - 1]?.role === "user" ? messages[index - 1]!.content : "";
        return (
          <>
            {showError ? (
              <div className="chat-msg-error-placeholder">
                <p>An error occurred.</p>
                <div className="chat-msg-error-actions">
                  {lastUserMessage.trim() ? (
                    <button
                      type="button"
                      className="chat-view-traces-btn chat-msg-error-retry"
                      onClick={() => send(undefined, lastUserMessage)}
                      disabled={loading || !providerId}
                      title={!providerId ? "Select an LLM provider first" : "Retry the last message"}
                    >
                      <RotateCw size={12} />
                      Retry
                    </button>
                  ) : null}
                  <a
                    href={conversationId ? `/chat/traces?conversationId=${encodeURIComponent(conversationId)}` : "/chat/traces"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="chat-view-traces-link"
                  >
                    View stack trace for details <ExternalLink size={12} />
                  </a>
                </div>
              </div>
            ) : (displayState.displayContent.trim() !== "" || displayState.structuredContent) ? (
              <>
                <ChatMessageContent content={displayState.displayContent} structuredContent={displayState.structuredContent} />
                {displayState.hasAskUserWaiting && isLastMessage && !loading && (() => {
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
                            <button type="button" className="chat-inline-option-btn" onClick={() => send(undefined, opt.value)} disabled={!providerId} title={opt.label !== opt.value ? `Send "${opt.value}"` : undefined}>
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
          </>
        );
      })()}
      {msg.role === "assistant" && list.length > 0 && (
        <ChatMessageResourceLinks results={list} />
      )}
      {msg.role === "assistant" && (() => {
        const filtered = list.filter((r) => r.name !== "ask_user" && r.name !== "ask_credentials" && r.name !== "format_response");
        if (filtered.length === 0) return null;
        return (
          <div className="chat-tool-results-wrap">
            <ChatToolResults
              results={filtered}
              onShellCommandApprove={onShellCommandApprove}
              onShellCommandAddToAllowlist={onShellCommandAddToAllowlist}
              shellCommandLoading={shellCommandLoading}
            />
          </div>
        );
      })()}
      {msg.role === "assistant" && msg.todos && msg.todos.length > 0 && !isLastMessage && (
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
      {FeedbackActions}
    </div>
  );
}

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
  const [credentialInput, setCredentialInput] = useState("");
  const [credentialSave, setCredentialSave] = useState(false);
  const [vaultLocked, setVaultLocked] = useState(true);
  const [vaultExists, setVaultExists] = useState(false);
  const [vaultPassword, setVaultPassword] = useState("");
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [vaultLoading, setVaultLoading] = useState(false);
  const [showVaultForm, setShowVaultForm] = useState(false);
  const [shellCommandLoading, setShellCommandLoading] = useState(false);
  const [pendingInputIds, setPendingInputIds] = useState<Set<string>>(new Set());
  const CHAT_DEFAULT_PROVIDER_KEY = "chat-default-provider-id";
  const scrollRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const prevConversationIdRef = useRef<string | null>(null);
  const lockVaultBtnRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const resizeInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  // When opened with a new conversation (e.g. run output), use it and don't load messages
  useEffect(() => {
    if (open && initialConversationId) {
      setConversationId(initialConversationId);
      setMessages([]);
      setLoaded(true);
      clearInitialConversationId?.();
    }
  }, [open, initialConversationId, clearInitialConversationId]);

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

  useEffect(() => {
    if (!open) return;
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
  }, [open]);

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
            } as Message;
          }));
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

  const fetchVaultStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/vault/status", { credentials: "include" });
      const data = await res.json();
      setVaultLocked(data.locked === true);
      setVaultExists(data.vaultExists === true);
    } catch {
      setVaultLocked(true);
      setVaultExists(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchVaultStatus();
  }, [open, fetchVaultStatus]);

  const handleVaultUnlock = useCallback(async () => {
    if (!vaultPassword.trim()) return;
    setVaultLoading(true);
    setVaultError(null);
    try {
      const endpoint = vaultExists ? "/api/vault/unlock" : "/api/vault/create";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ masterPassword: vaultPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setVaultError(data.error || "Failed");
        return;
      }
      setVaultLocked(false);
      setVaultExists(true);
      setVaultPassword("");
      setShowVaultForm(false);
      // Move focus to the Lock vault button so no text input shows a blinking cursor (defer until after React has re-rendered)
      setTimeout(() => {
        requestAnimationFrame(() => {
          lockVaultBtnRef.current?.focus();
          const active = typeof document !== "undefined" ? document.activeElement : null;
          if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
            active.blur();
          }
        });
      }, 0);
    } catch {
      setVaultError("Request failed");
    } finally {
      setVaultLoading(false);
    }
  }, [vaultExists, vaultPassword]);

  const handleVaultLock = useCallback(async () => {
    setVaultLoading(true);
    try {
      await fetch("/api/vault/lock", { method: "POST", credentials: "include" });
      setVaultLocked(true);
      setShowVaultForm(false);
    } catch {
      // ignore
    } finally {
      setVaultLoading(false);
    }
  }, []);

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

  // Keep status at bottom in view when trace steps or loading state update
  const lastMsg = messages[messages.length - 1];
  const lastTraceSteps = lastMsg?.role === "assistant" ? lastMsg.traceSteps : undefined;
  useEffect(() => {
    if (open && loading && lastMsg?.role === "assistant") {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [loading, lastTraceSteps, lastMsg?.role, open]);

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

  const send = async (payload?: unknown, optionValue?: string, extraBody?: Record<string, unknown>) => {
    const credentialPayload = payload != null && typeof payload === "object" && "credentialKey" in payload && "value" in payload && "save" in payload
      ? (payload as { credentialKey: string; value: string; save: boolean })
      : undefined;
    const isCredentialReply = credentialPayload != null;
    const text = isCredentialReply ? "Credentials provided." : (optionValue !== undefined ? optionValue : input.trim());
    if (!text || loading) return;
    if (!isCredentialReply && optionValue === undefined && !extraBody?.continueShellApproval) {
      setInput("");
      if (conversationId) setDraft(conversationId, "");
    }

    const userMsg: Message = { id: randomId(), role: "user", content: text };
    const placeholderId = randomId();
    setMessages((prev) => [...prev, userMsg, { id: placeholderId, role: "assistant", content: "" }]);
    setLoading(true);
    abortRef.current = new AbortController();

    const buildBody = (base: Record<string, unknown>) => {
      const body = { ...base };
      if (isCredentialReply && credentialPayload) body.credentialResponse = credentialPayload;
      if (attachedContext) {
        body.attachedContext = attachedContext;
        clearAttachedContext?.();
      }
      return body;
    };

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
      buildBody,
      extraBody,
      onAbort: () => { abortRef.current = null; },
      onInputRestore: !isCredentialReply ? (t) => setInput(t) : undefined,
    });
    abortRef.current = null;
  };

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
        send(undefined, `The shell command failed: ${err}`);
        return;
      }
      const stdout = (data.stdout ?? "").trim();
      const stderr = (data.stderr ?? "").trim();
      const exitCode = data.exitCode;
      send(undefined, "Command approved and run.", {
        continueShellApproval: { command, stdout, stderr, exitCode },
      });
    } catch {
      send(undefined, "Failed to execute the shell command.");
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
        send(undefined, msg);
      } else {
        send(undefined, `Failed to add to allowlist: ${data.error || "Unknown error"}`);
      }
    } catch {
      send(undefined, "Failed to add command to allowlist.");
    } finally {
      setShellCommandLoading(false);
    }
  }, [shellCommandLoading, send]);

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
          <li key={c.id} className="chat-conversation-li">
            <button
              type="button"
              className={`chat-conversation-item ${isCurrent ? "active" : ""}`}
              onClick={() => {
                setConversationId(c.id);
                if (!embedded) setShowConversationList(false);
              }}
            >
              {status && (
                <span className={`chat-conversation-status chat-conversation-status-${status}`} title={status === "running" ? "Running" : status === "waiting" ? "Waiting for input" : "Finished"}>
                  {status === "finished" && <Check size={12} />}
                  {status === "running" && <Loader size={12} className="chat-conv-status-loader" />}
                  {status === "waiting" && <CircleDot size={12} />}
                </span>
              )}
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
          );
        })}
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
          <button
            type="button"
            className="chat-header-btn"
            onClick={startNewChat}
            title="New chat"
            aria-label="New chat"
          >
            <MessageSquarePlus size={14} />
          </button>
          <a
            href={conversationId ? `/chat/traces?conversationId=${encodeURIComponent(conversationId)}` : "/chat/traces"}
            target="_blank"
            rel="noopener noreferrer"
            className="chat-header-btn"
            title="Open stack trace for this chat"
            aria-label="Open stack trace"
          >
            <GitBranch size={14} />
          </a>
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

        {/* Vault: credentials are stored only when vault is unlocked (master password). Agent cannot access when locked. */}
        <div className="chat-vault-bar">
          {vaultLocked ? (
            <>
              <Lock size={14} className="chat-vault-icon" aria-hidden />
              <span className="chat-vault-label">Vault locked — saved credentials unavailable</span>
              {!showVaultForm ? (
                <button type="button" className="chat-vault-btn" onClick={() => setShowVaultForm(true)}>
                  {vaultExists ? "Unlock" : "Create vault"}
                </button>
              ) : (
                <div className="chat-vault-form">
                  <input
                    type="password"
                    className="chat-vault-input"
                    placeholder={vaultExists ? "Master password" : "Choose master password"}
                    value={vaultPassword}
                    onChange={(e) => { setVaultPassword(e.target.value); setVaultError(null); }}
                    onKeyDown={(e) => e.key === "Enter" && handleVaultUnlock()}
                    aria-label="Vault master password"
                  />
                  <button type="button" className="chat-vault-btn" onClick={handleVaultUnlock} disabled={vaultLoading || !vaultPassword.trim()}>
                    {vaultLoading ? "…" : vaultExists ? "Unlock" : "Create"}
                  </button>
                  <button type="button" className="chat-vault-btn chat-vault-btn-ghost" onClick={() => { setShowVaultForm(false); setVaultPassword(""); setVaultError(null); }}>Cancel</button>
                  {vaultError && <span className="chat-vault-error">{vaultError}</span>}
                </div>
              )}
            </>
          ) : (
            <>
              <Unlock size={14} className="chat-vault-icon chat-vault-icon-unlocked" aria-hidden />
              <span className="chat-vault-label">Vault unlocked</span>
              <button type="button" ref={lockVaultBtnRef} className="chat-vault-btn" onClick={handleVaultLock} disabled={vaultLoading}>Lock vault</button>
            </>
          )}
        </div>

        {/* Messages */}
        <div className="chat-messages" ref={scrollRef}>
          <div className="chat-messages-content">
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
          {messages.map((msg, index) => (
            <ChatModalMessageRow
              key={msg.id}
              msg={msg}
              index={index}
              messages={messages}
              loading={loading}
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
          {(() => {
            const askCreds = lastMsg?.role === "assistant" && lastMsg.toolResults
              ? lastMsg.toolResults.find((r) => r.name === "ask_credentials" && r.result && typeof r.result === "object" && (r.result as { credentialRequest?: boolean }).credentialRequest === true)
              : undefined;
            const pendingCredential = !loading && askCreds?.result && typeof askCreds.result === "object"
              ? { question: (askCreds.result as { question?: string }).question ?? "Enter credential", credentialKey: (askCreds.result as { credentialKey?: string }).credentialKey ?? "credential" }
              : null;
            if (!pendingCredential) return null;
            return (
              <div className="chat-credential-form" aria-label="Enter credential securely">
                <p className="chat-credential-prompt">{pendingCredential.question}</p>
                <div className="chat-credential-fields">
                  <KeyRound size={16} className="chat-credential-icon" aria-hidden />
                  <input
                    type="password"
                    className="chat-credential-input"
                    placeholder="Enter value (never shown in chat)"
                    value={credentialInput}
                    onChange={(e) => setCredentialInput(e.target.value)}
                    autoComplete="off"
                    aria-label="Credential value"
                  />
                </div>
                <label className="chat-credential-save-label" title={vaultLocked ? "Unlock the vault above to save credentials" : undefined}>
                  <input
                    type="checkbox"
                    checked={credentialSave}
                    onChange={(e) => setCredentialSave(e.target.checked)}
                    disabled={vaultLocked}
                    className="chat-credential-save-checkbox"
                  />
                  <span>Save for future use{vaultLocked ? " (unlock vault first)" : ""}</span>
                </label>
                <button
                  type="button"
                  className="chat-credential-submit"
                  disabled={!credentialInput.trim()}
                  onClick={() => {
                    const value = credentialInput.trim();
                    if (!value) return;
                    setCredentialInput("");
                    setCredentialSave(false);
                    send({ credentialKey: pendingCredential.credentialKey, value, save: credentialSave });
                  }}
                >
                  Submit
                </button>
              </div>
            );
          })()}
        </div>

        {loading && lastMsg?.role === "assistant" && (() => {
          const status = getLoadingStatus(lastMsg as Message & { traceSteps?: { phase: string; label?: string }[]; todos?: string[]; completedStepIndices?: number[]; executingStepIndex?: number; executingToolName?: string; executingSubStepLabel?: string; reasoning?: string });
          return (
            <div className="chat-status-bar" aria-live="polite">
              <LogoLoading size={18} className="chat-status-bar-logo" />
              <span>{status}</span>
            </div>
          );
        })()}

        {providers.length === 0 && (
          <div className="chat-no-model-banner">
            No model selected. <a href="/settings/llm" className="chat-settings-link">Add an LLM provider in Settings</a> to send messages.
          </div>
        )}
        {/* Input */}
        <div className="chat-input-bar">
          <textarea
            ref={inputRef}
            className="chat-input chat-input-textarea"
            placeholder="Message assistant... (Shift+Enter for new line)"
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
            <button type="button" className="chat-stop-btn" onClick={stopRequest} title="Stop">
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              className="chat-send-btn"
              onClick={() => send()}
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
