"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import {
  Send,
  Loader,
  Loader2,
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

/** Minimum time (ms) to show the loading status bar after sending (so option clicks show visible feedback). */
const MIN_LOADING_DISPLAY_MS = 600;

import ChatFeedbackModal from "./chat-feedback-modal";
import MessageFeedbackModal from "./message-feedback-modal";
import LogoLoading from "./logo-loading";
import BrandIcon from "./brand-icon";
import { AgentRequestBlock } from "./agent-request-block";
import {
  loadChatState,
  saveChatState,
  subscribeToChatStateChanges,
  getRunWaiting as getRunWaitingFromCache,
  setRunWaiting as setRunWaitingInCache,
  LOADING_FRESH_MS,
  getLastActiveConversationId,
} from "../lib/chat-state-cache";
import { getDraft, setDraft } from "../lib/chat-drafts";

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
  openMessageFeedback: (msg: Message, label: "good" | "bad") => void;
  feedbackLabel: "good" | "bad" | null;
  send: (value: string) => void;
  providerId: string;
  conversationId: string | null;
  getMessageCopyText: (msg: Message) => string;
  onShellCommandApprove?: (command: string) => void;
  onShellCommandAddToAllowlist?: (command: string) => void;
  shellCommandLoading?: boolean;
  optionSending: { messageId: string; label: string } | null;
  setOptionSending: React.Dispatch<React.SetStateAction<{ messageId: string; label: string } | null>>;
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
  openMessageFeedback,
  feedbackLabel,
  send,
  providerId,
  conversationId,
  getMessageCopyText,
  onShellCommandApprove,
  onShellCommandAddToAllowlist,
  shellCommandLoading = false,
  optionSending,
  setOptionSending,
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
      <button
        type="button"
        className={feedbackLabel === "good" ? "chat-section-feedback-btn-active" : ""}
        onClick={(e) => { e.stopPropagation(); openMessageFeedback(msg, "good"); }}
        title={feedbackLabel === "good" ? "Rated good" : "Good"}
        aria-pressed={feedbackLabel === "good"}
      >
        <ThumbsUp size={14} />
      </button>
      <button
        type="button"
        className={feedbackLabel === "bad" ? "chat-section-feedback-btn-active" : ""}
        onClick={(e) => { e.stopPropagation(); openMessageFeedback(msg, "bad"); }}
        title={feedbackLabel === "bad" ? "Rated bad" : "Bad"}
        aria-pressed={feedbackLabel === "bad"}
      >
        <ThumbsDown size={14} />
      </button>
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
        const isRetrying = showError && loading && messages[index + 1]?.role === "user" && messages[index + 1]?.content === lastUserMessage;
        const errorText = msg.content.startsWith("Error: ") ? msg.content.slice(6).trim() : msg.content;
        return (
          <>
            {showError ? (
              <div className="chat-section-error">
                {isRetrying ? (
                  <p className="chat-section-error-retrying">
                    <Loader size={14} className="spin" aria-hidden />
                    Retrying…
                  </p>
                ) : (
                  <>
                    <p>{errorText || "Something went wrong."}</p>
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
                  </>
                )}
              </div>
            ) : (displayState.displayContent.trim() !== "" || displayState.structuredContent) ? (
              <>
                <ChatMessageContent content={displayState.displayContent} structuredContent={displayState.structuredContent} />
                {(() => {
                  const wouldShowOptions = displayState.hasAskUserWaiting && isLast && !loading;
                  const optsFromText = !wouldShowOptions && isLast && !loading && /choose|option|please pick/i.test(displayState.displayContent)
                    ? getSuggestedOptionsFromToolResults([], displayState.displayContent || "")
                    : [];
                  // #region agent log
                  if (msg.role === "assistant" && isLast && !loading && /choose|option|please pick/i.test(displayState.displayContent)) {
                    fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: "chat-section.tsx:options-skip", message: "Options block skipped or rendered", data: { wouldShowOptions, hasAskUserWaiting: displayState.hasAskUserWaiting, optsFromTextCount: optsFromText.length, optsFromTextPreview: optsFromText.slice(0, 5).map((o) => o.label) }, timestamp: Date.now(), hypothesisId: "H3-H5" }) }).catch(() => {});
                  }
                  // #endregion
                  return wouldShowOptions && (() => {
                  const opts = msg.interactivePrompt?.options && msg.interactivePrompt.options.length > 0
                    ? msg.interactivePrompt.options.map((s) => ({ value: s, label: s }))
                    : getSuggestedOptionsFromToolResults(list, displayState.displayContent || "");
                  // #region agent log
                  fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: "chat-section.tsx:inline-options", message: "Options block rendering", data: { hasAskUserWaiting: displayState.hasAskUserWaiting, isLast, loading, optsCount: opts.length, optsPreview: opts.slice(0, 5).map((o) => o.label) }, timestamp: Date.now(), hypothesisId: "H4" }) }).catch(() => {});
                  // #endregion
                  if (opts.length === 0) return null;
                  const sendingForThisMsg = optionSending?.messageId === msg.id;
                  return (
                    <div className="chat-inline-options" role="group" aria-label="Choose an option">
                      <span className="chat-inline-options-label">Choose an option:</span>
                      <ul className="chat-inline-options-list">
                        {opts.map((opt) => {
                          const isSendingThis = sendingForThisMsg && optionSending?.label === opt.label;
                          return (
                            <li key={opt.value}>
                              <button
                                type="button"
                                className="chat-inline-option-btn"
                                onClick={() => {
                                  setOptionSending({ messageId: msg.id, label: opt.label });
                                  void send(opt.label);
                                }}
                                disabled={!providerId || sendingForThisMsg}
                                title="Send this option as your reply"
                              >
                                {isSendingThis ? (
                                  <>
                                    <Loader2 size={14} className="spin" style={{ marginRight: 6, verticalAlign: "middle" }} aria-hidden />
                                    Sending…
                                  </>
                                ) : (
                                  opt.label
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })();
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
  const [messageFeedback, setMessageFeedback] = useState<{ msg: Message; label: "good" | "bad" } | null>(null);
  const [messageFeedbackSubmitting, setMessageFeedbackSubmitting] = useState(false);
  const [feedbackByContentKey, setFeedbackByContentKey] = useState<Record<string, "good" | "bad">>({});
  const [providers, setProviders] = useState<LlmProvider[]>([]);
  const [providerId, setProviderId] = useState("");
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [collapsedStepsByMsg, setCollapsedStepsByMsg] = useState<Record<string, boolean>>({});
  const [runFinishedNotification, setRunFinishedNotification] = useState<{ runId: string; status: string } | null>(null);
  const [shellCommandLoading, setShellCommandLoading] = useState(false);
  const [pendingInputIds, setPendingInputIds] = useState<Set<string>>(new Set());
  const [runWaiting, setRunWaiting] = useState(false);
  const [runWaitingData, setRunWaitingData] = useState<{ runId: string; question?: string; options?: string[] } | null>(null);
  /** When set, an option was just clicked for this message; show loading on that option and disable others until send completes. */
  const [optionSending, setOptionSending] = useState<{ messageId: string; label: string } | null>(null);

  const CHAT_DEFAULT_PROVIDER_KEY = "chat-default-provider-id";
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const prevConversationIdRef = useRef<string | null>(null);
  const crossTabStateRef = useRef<{ messageCount: number; loading: boolean }>({ messageCount: 0, loading: false });
  const loadingStartedAtRef = useRef<number | null>(null);
  const minLoadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** When the user last changed the input (keystroke); used to avoid overwriting with stale draft from broadcast. */
  const lastLocalInputChangeAtRef = useRef<number>(0);
  /** Current input value so broadcast handler can read latest without stale closure. */
  const currentInputRef = useRef(input);
  currentInputRef.current = input;

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
    fetch("/api/chat/conversations", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setConversationList(list);
        setConversationId((current) => {
          if (!current && list.length > 0) {
            const lastActive = getLastActiveConversationId();
            if (lastActive && list.some((c: { id: string }) => c.id === lastActive)) return lastActive;
            return list[0].id;
          }
          return current;
        });
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  useEffect(() => {
    fetchConversationList();
  }, [fetchConversationList]);

  // Content key for matching feedback to messages (stable across restore/API replace)
  const feedbackContentKey = useCallback((prev: string, out: string) => `${prev}\n\x00\n${out}`, []);

  // Load chat feedback and map by (input, output) so thumb state survives restore and API message replace
  useEffect(() => {
    if (messages.length === 0) {
      setFeedbackByContentKey({});
      return;
    }
    fetch("/api/feedback?targetType=chat")
      .then((r) => r.json())
      .then((list: { input: unknown; output: unknown; label: string; createdAt: number }[]) => {
        const items = Array.isArray(list) ? list : [];
        const byKey: Record<string, "good" | "bad"> = {};
        items
          .filter((f) => f.label === "good" || f.label === "bad")
          .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
          .forEach((f) => {
            const inStr = typeof f.input === "string" ? f.input : JSON.stringify(f.input ?? "");
            const outStr = typeof f.output === "string" ? f.output : JSON.stringify(f.output ?? "");
            const key = `${inStr}\n\x00\n${outStr}`;
            if (byKey[key] === undefined) byKey[key] = f.label as "good" | "bad";
          });
        setFeedbackByContentKey(byKey);
      })
      .catch(() => setFeedbackByContentKey({}));
  }, [messages]);

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

  const fetchRunWaiting = useCallback(() => {
    if (!conversationId) return;
    fetch(`/api/chat/run-waiting?conversationId=${encodeURIComponent(conversationId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.runWaiting === true) {
          const runId = d.runId ?? "";
          const data = {
            runId,
            question: d.question,
            options: Array.isArray(d.options) ? d.options : [],
          };
          const willFetchAgentRequest = !!(runId && (!data.question?.trim() || (Array.isArray(data.options) && data.options.length === 0)));
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat-section:fetchRunWaiting',message:'run-waiting true',data:{runId,questionLen:data.question?.length??0,optionsLen:data.options?.length??0,willFetchAgentRequest},hypothesisId:'H1',timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          setRunWaiting(true);
          setRunWaitingData(data);
          setRunWaitingInCache(conversationId, data);
          // If run-waiting didn't return question/options, fetch from run's agent-request endpoint (single source of truth)
          if (willFetchAgentRequest) {
            fetch(`/api/runs/${encodeURIComponent(runId)}/agent-request`, { cache: "no-store" })
              .then((ar) => (ar.ok ? ar.json() : null))
              .then((payload: { question?: string; options?: string[] } | null) => {
                if (!payload) return;
                const question = typeof payload.question === "string" && payload.question.trim() ? payload.question.trim() : undefined;
                const options = Array.isArray(payload.options) ? payload.options : [];
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat-section:agent-request-then',message:'agent-request response',data:{runId,questionLen:question?.length??0,optionsLen:options.length,willMerge:!!(question||options.length>0)},hypothesisId:'H4',timestamp:Date.now()})}).catch(()=>{});
                // #endregion
                if (question || options.length > 0) {
                  setRunWaitingData((prev) =>
                    prev?.runId === runId ? { ...prev, question: question ?? prev?.question, options: options.length > 0 ? options : (prev?.options ?? []) } : prev
                  );
                  setRunWaitingInCache(conversationId, { runId, question, options: options.length > 0 ? options : (data.options ?? []) });
                }
              })
              .catch(() => {});
          }
        } else {
          setRunWaiting(false);
          setRunWaitingData(null);
          setRunWaitingInCache(conversationId, null);
          setRunFinishedNotification(null);
        }
      })
      .catch(() => {
        setRunWaiting(false);
        setRunWaitingData(null);
        setRunWaitingInCache(conversationId, null);
        setRunFinishedNotification(null);
      });
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) {
      setRunWaiting(false);
      setRunWaitingData(null);
      return;
    }
    const cached = getRunWaitingFromCache(conversationId);
    if (cached) {
      setRunWaiting(true);
      setRunWaitingData(cached);
    }
    fetchRunWaiting();
    const interval = setInterval(fetchRunWaiting, 2000);
    return () => clearInterval(interval);
  }, [conversationId, fetchRunWaiting]);

  // When we have a waiting run but no question (e.g. from cache or run started outside chat), fetch agent-request by run ID
  useEffect(() => {
    const data = runWaitingData;
    if (!data?.runId) return;
    const noRealQuestion =
      !data.question ||
      data.question.trim() === "" ||
      data.question === "The agent is waiting for your input.";
    if (!noRealQuestion) return;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat-section:backfill-effect',message:'backfill running',data:{runId:data.runId},hypothesisId:'H4',timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    let cancelled = false;
    fetch(`/api/runs/${encodeURIComponent(data.runId)}/agent-request`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((payload: { question?: string; options?: string[] } | null) => {
        if (cancelled || !payload) return;
        const question = typeof payload.question === "string" && payload.question.trim() ? payload.question.trim() : undefined;
        const options = Array.isArray(payload.options) ? payload.options : [];
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chat-section:backfill-then',message:'backfill agent-request response',data:{runId:data.runId,questionLen:question?.length??0,optionsLen:options.length},hypothesisId:'H4',timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        if (question || options.length > 0) {
          setRunWaitingData((prev) =>
            prev?.runId === data.runId
              ? { ...prev, question: question ?? prev?.question, options: options.length > 0 ? options : (prev?.options ?? []) }
              : prev
          );
          if (conversationId) {
            setRunWaitingInCache(conversationId, {
              runId: data.runId,
              question: question ?? undefined,
              options: options.length > 0 ? options : (data.options ?? []),
            });
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [runWaitingData?.runId, runWaitingData?.question, conversationId]);

  // Per-conversation input drafts: save when switching away, load when switching to a conversation
  useEffect(() => {
    const prev = prevConversationIdRef.current;
    if (prev) setDraft(prev, input);
    prevConversationIdRef.current = conversationId;
    if (conversationId) {
      setInput(getDraft(conversationId));
      lastLocalInputChangeAtRef.current = Date.now();
    }
  }, [conversationId]);

  // Save draft on page unload so refresh/navigation preserves it (including empty = clear draft)
  useEffect(() => {
    const onBeforeUnload = () => {
      if (conversationId) setDraft(conversationId, input);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [conversationId, input]);

  // Debounced draft save so text typed here is visible in the FAB modal (and survives without switching conversation)
  useEffect(() => {
    if (!conversationId) return;
    const t = setTimeout(() => {
      setDraft(conversationId, input);
    }, 400);
    return () => clearTimeout(t);
  }, [conversationId, input]);

  // Refetch list when user returns to the tab so conversations started in the FAB are visible
  useEffect(() => {
    const onFocus = () => fetchConversationList();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchConversationList]);

  // Load messages when conversation changes; restore from shared cache if we have recent state (e.g. user returned while thinking)
  useEffect(() => {
    if (!conversationId) return;
    const restored = loadChatState(conversationId);
    if (restored) {
      // #region agent log
      if (typeof fetch !== "undefined") fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({location:"chat-section:apply_restored",message:"apply restored cache",data:{msgLen:restored.messages.length,loading:restored.loading},hypothesisId:"H1_H3",timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      const isFresh = Date.now() - restored.timestamp <= LOADING_FRESH_MS;
      const restoredLoading = restored.loading && isFresh;
      crossTabStateRef.current = { messageCount: restored.messages.length, loading: restoredLoading };
      setMessages(restored.messages as Message[]);
      setLoading(restoredLoading);
      if (restored.runWaiting != null && typeof restored.runWaiting === "object" && typeof (restored.runWaiting as { runId: string }).runId === "string") {
        setRunWaiting(true);
        setRunWaitingData(restored.runWaiting as { runId: string; question?: string; options?: string[] });
      }
      setLoaded(true);
      // Background fetch: API is source of truth so updates are visible after refresh
      fetch(`/api/chat?conversationId=${encodeURIComponent(conversationId)}`, { cache: "no-store" })
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
          // Prefer API whenever it has same or more messages so refresh always shows latest
          const useApi = apiMessages.length >= restored.messages.length;
          // #region agent log
          if (typeof fetch !== "undefined") fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({location:"chat-section:api_done",message:"API fetch done",data:{useApi,apiLen:apiMessages.length,restoredLen:restored.messages.length},hypothesisId:"H1",timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          if (useApi) {
            crossTabStateRef.current = { messageCount: apiMessages.length, loading: false };
            setMessages(apiMessages);
            setLoading(false);
          }
        })
        .catch(() => {});
      return;
    }
    // #region agent log
    if (typeof fetch !== "undefined") fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({location:"chat-section:load_no_cache",message:"load effect no cache, fetching",data:{conversationId},hypothesisId:"H1",timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    setLoaded(false);
    fetch(`/api/chat?conversationId=${encodeURIComponent(conversationId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          // #region agent log
          if (typeof fetch !== "undefined") fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({location:"chat-section:load_no_cache_set",message:"no-cache fetch result applied",data:{apiLen:data.length,willSetEmpty:data.length===0},hypothesisId:"H1",timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          const msgs = data.map((m: Record<string, unknown>) => {
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
          crossTabStateRef.current = { messageCount: msgs.length, loading: false };
          setMessages(msgs);
          setLoading(false);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [conversationId]);

  // Persist messages, loading, and draft (debounced; broadcasts to other tabs via BroadcastChannel)
  const persistDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!conversationId || !loaded) return;
    if (persistDebounceRef.current) clearTimeout(persistDebounceRef.current);
    persistDebounceRef.current = setTimeout(() => {
      persistDebounceRef.current = null;
      // #region agent log
      if (typeof fetch !== "undefined") fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({location:"chat-section:persist",message:"saveChatState",data:{msgLen:messages.length,loading},hypothesisId:"H3",timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      saveChatState(conversationId, messages, loading, input);
    }, 600);
    return () => {
      if (persistDebounceRef.current) clearTimeout(persistDebounceRef.current);
    };
  }, [conversationId, loaded, messages, loading, input]);

  // Cross-tab: when another tab updates the cache, show updated thinking state (throttled to avoid constant refresh)
  const crossTabApplyRef = useRef<{ conversationId: string; timestamp: number; appliedAt: number } | null>(null);
  const CROSS_TAB_THROTTLE_MS = 2500;
  useEffect(() => {
    const unsubscribe = subscribeToChatStateChanges((cid, data) => {
      if (cid !== conversationId) return;
      const now = Date.now();
      const prev = crossTabApplyRef.current;
      if (prev?.conversationId === cid && data.timestamp <= prev.timestamp) return;
      if (prev?.conversationId === cid && now - prev.appliedAt < CROSS_TAB_THROTTLE_MS) return;
      const state = crossTabStateRef.current;
      const msgCount = data.messages?.length ?? 0;
      if (data.loading && msgCount <= state.messageCount && !state.loading) return;
      // Don't apply stale broadcast that would hide our loading state (e.g. after cancelling run, then sending in this tab)
      if (state.loading && !data.loading && msgCount <= state.messageCount) return;
      // Don't apply stale "loading true" broadcast that would re-show spinner and overwrite completed response (stream finished in this tab, then old persist broadcasts)
      if (!state.loading && data.loading && msgCount <= state.messageCount) return;
      // #region agent log
      if (typeof fetch !== "undefined") fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({location:"chat-section:cross_tab",message:"cross-tab apply",data:{msgLen:data.messages?.length,loading:data.loading},hypothesisId:"H2",timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      crossTabApplyRef.current = { conversationId: cid, timestamp: data.timestamp, appliedAt: now };
      const isFresh = now - data.timestamp <= LOADING_FRESH_MS;
      const nextLoading = data.loading && isFresh;
      crossTabStateRef.current = { messageCount: msgCount, loading: nextLoading };
      setMessages(data.messages as Message[]);
      setLoading(nextLoading);
      // Only apply incoming draft when not actively typing (avoids overwriting with older debounced save = isolated word pieces)
      if (data.draft !== undefined) {
        const idleMs = 2000;
        const current = currentInputRef.current;
        if (current === "" || now - lastLocalInputChangeAtRef.current > idleMs) setInput(data.draft);
      }
      if (data.runWaiting !== undefined) {
        const rw = data.runWaiting;
        if (rw != null && typeof rw === "object" && typeof (rw as { runId: string }).runId === "string") {
          setRunWaiting(true);
          setRunWaitingData(rw as { runId: string; question?: string; options?: string[] });
        } else {
          setRunWaiting(false);
          setRunWaitingData(null);
        }
      }
    });
    return unsubscribe;
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

  const lastMsg = messages[messages.length - 1];
  const lastTraceSteps = lastMsg?.role === "assistant" ? lastMsg.traceSteps : undefined;
  // Clear option-sending state when request finishes so buttons are clickable again
  useEffect(() => {
    if (!loading) setOptionSending(null);
  }, [loading]);
  // Only auto-scroll when we're actively streaming (loading + assistant last), not on every messages update (refetch/cross-tab would scroll away)
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
    setRunWaiting(false);
    setRunWaitingData(null);
    if (textOverride === undefined && !extraBody?.continueShellApproval) {
      setInput("");
      if (conversationId) setDraft(conversationId, "");
    }
    const userMsg: Message = { id: randomId(), role: "user", content: text };
    const placeholderId = randomId();
    setMessages((prev) => [...prev, userMsg, { id: placeholderId, role: "assistant", content: "" }]);
    loadingStartedAtRef.current = Date.now();
    if (minLoadingTimerRef.current) {
      clearTimeout(minLoadingTimerRef.current);
      minLoadingTimerRef.current = null;
    }
    setLoading(true);
    crossTabStateRef.current = { messageCount: messages.length + 2, loading: true };
    abortRef.current = new AbortController();
      const setLoadingWithMinDisplay = (v: boolean) => {
      if (v) {
        setLoading(true);
        return;
      }
      const started = loadingStartedAtRef.current;
      const elapsed = started != null ? Date.now() - started : MIN_LOADING_DISPLAY_MS;
      const remaining = Math.max(0, MIN_LOADING_DISPLAY_MS - elapsed);
      if (remaining > 0) {
        minLoadingTimerRef.current = setTimeout(() => {
          minLoadingTimerRef.current = null;
          setLoading(false);
          crossTabStateRef.current = { ...crossTabStateRef.current, loading: false };
        }, remaining);
      } else {
        setLoading(false);
        crossTabStateRef.current = { ...crossTabStateRef.current, loading: false };
      }
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
      setLoading: setLoadingWithMinDisplay,
      abortSignal: abortRef.current?.signal,
      randomId,
      normalizeToolResults,
      buildBody: (base) => base,
      extraBody,
      onRunFinished: (runId, status, details) => {
        if (status === "waiting_for_user") {
          setRunFinishedNotification({ runId, status });
          if (details && (details.question || (details.options && details.options.length > 0))) {
            setRunWaiting(true);
            setRunWaitingData({
              runId,
              question: details.question,
              options: details.options,
            });
            if (conversationId) setRunWaitingInCache(conversationId, { runId, question: details.question, options: details.options });
          }
          void fetchRunWaiting();
        } else {
          setRunFinishedNotification(null);
        }
        if (status === "waiting_for_user" && conversationId) {
          fetch(`/api/chat?conversationId=${encodeURIComponent(conversationId)}`, { cache: "no-store" })
            .then((r) => r.json())
            .then((data) => {
              if (!Array.isArray(data)) return;
              // #region agent log
              if (typeof fetch !== "undefined") fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({location:"chat-section:onRunFinished_setMessages",message:"onRunFinished fetch applying messages",data:{apiLen:Array.isArray(data)?data.length:0},hypothesisId:"H3",timestamp:Date.now()})}).catch(()=>{});
              // #endregion
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
      onDone: fetchRunWaiting,
      onAbort: () => {
        abortRef.current = null;
        if (minLoadingTimerRef.current) {
          clearTimeout(minLoadingTimerRef.current);
          minLoadingTimerRef.current = null;
        }
        setLoading(false);
        crossTabStateRef.current = { ...crossTabStateRef.current, loading: false };
      },
      onInputRestore: (t) => setInput(t),
    });
    abortRef.current = null;
  }, [input, loading, messages, providerId, conversationId, pathname, fetchRunWaiting]);

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

  const openMessageFeedback = useCallback((msg: Message, label: "good" | "bad") => {
    setMessageFeedback({ msg, label });
  }, []);

  const submitMessageFeedback = useCallback(async (notes: string) => {
    if (!messageFeedback) return;
    setMessageFeedbackSubmitting(true);
    const prevUser = messages[messages.indexOf(messageFeedback.msg) - 1];
    const prevContent = prevUser?.content ?? "";
    const outputContent = messageFeedback.msg.content;
    const key = feedbackContentKey(prevContent, outputContent);
    const label = messageFeedback.label;
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: "chat",
          targetId: "chat",
          input: prevContent,
          output: outputContent,
          label,
          notes: notes || undefined,
        }),
      });
      setMessageFeedback(null);
      setFeedbackByContentKey((prev) => ({ ...prev, [key]: label }));
    } finally {
      setMessageFeedbackSubmitting(false);
    }
  }, [messageFeedback, messages, feedbackContentKey]);

  const closeMessageFeedback = useCallback(() => setMessageFeedback(null), []);

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
                  openMessageFeedback={openMessageFeedback}
                  feedbackLabel={msg.role === "assistant" ? (feedbackByContentKey[feedbackContentKey((messages[index - 1] as Message | undefined)?.content ?? "", msg.content)] ?? null) : null}
                  send={send}
                  providerId={providerId}
                  conversationId={conversationId}
                  getMessageCopyText={getMessageCopyText}
                  onShellCommandApprove={handleShellCommandApprove}
                  onShellCommandAddToAllowlist={handleShellCommandAddToAllowlist}
                  shellCommandLoading={shellCommandLoading}
                  optionSending={optionSending}
                  setOptionSending={setOptionSending}
                />
              ))}
              {runWaiting && runWaitingData && (
                <AgentRequestBlock
                  question={runWaitingData.question}
                  options={runWaitingData.options}
                  runId={runWaitingData.runId}
                  viewRunHref={runWaitingData.runId ? `/runs/${runWaitingData.runId}` : undefined}
                  onReplyOption={(value) => send(value)}
                  onCancelRun={async () => {
                    if (!runWaitingData?.runId) return;
                    try {
                      await fetch(`/api/runs/${encodeURIComponent(runWaitingData.runId)}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ status: "cancelled", finishedAt: Date.now() }),
                      });
                      setRunWaiting(false);
                      setRunWaitingData(null);
                      if (conversationId) setRunWaitingInCache(conversationId, null);
                      setRunFinishedNotification(null);
                      setLoading(false);
                      crossTabStateRef.current = { ...crossTabStateRef.current, loading: false };
                    } catch {
                      // ignore
                    }
                  }}
                  showVagueHint
                />
              )}
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
              onChange={(e) => {
                lastLocalInputChangeAtRef.current = Date.now();
                setInput(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              onInput={resizeInput}
              rows={1}
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
      {messageFeedback && (
        <MessageFeedbackModal
          open
          onClose={closeMessageFeedback}
          label={messageFeedback.label}
          onSubmit={submitMessageFeedback}
          submitting={messageFeedbackSubmitting}
        />
      )}
    </section>
  );
}
