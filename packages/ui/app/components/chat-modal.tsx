"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Send, ThumbsUp, ThumbsDown, Loader, Loader2, Minus, Copy, Check, Circle, CircleDot, Square, MessageSquarePlus, List, Star, Trash2, ExternalLink, GitBranch, Network, Bot, Settings2, KeyRound, Lock, Unlock, RotateCw } from "lucide-react";
import { ChatMessageContent, ChatMessageResourceLinks, ChatToolResults, getAgentRequestFromToolResults, getAssistantMessageDisplayContent, getLoadingStatus, getMessageDisplayState, getSuggestedOptions, getSuggestedOptionsFromToolResults, hasAskUserWaitingForInput, messageContentIndicatesSuccess, messageHasSuccessfulToolResults, normalizeToolResults, ReasoningContent } from "./chat-message-content";
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

type TraceStep = { phase: string; label?: string; contentPreview?: string; inputPreview?: string; specialistId?: string; toolName?: string; toolInput?: unknown; toolOutput?: unknown };

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
  openMessageFeedback: (msg: Message, label: "good" | "bad") => void;
  feedbackLabel: "good" | "bad" | null;
  send: (payload?: unknown, optionValue?: string) => void | Promise<void>;
  providerId: string;
  conversationId: string | null;
  getMessageCopyText: (msg: Message) => string;
  onShellCommandApprove?: (command: string) => void;
  onShellCommandAddToAllowlist?: (command: string) => void;
  shellCommandLoading?: boolean;
  optionSending: { messageId: string; label: string } | null;
  setOptionSending: (v: { messageId: string; label: string } | null) => void;
};

function ChatModalMessageRow({
  msg,
  index,
  messages,
  loading,
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
      <button
        className={`chat-rate-btn ${feedbackLabel === "good" ? "chat-rate-btn-active" : ""}`}
        type="button"
        onClick={(e) => { e.stopPropagation(); openMessageFeedback(msg, "good"); }}
        title={feedbackLabel === "good" ? "Rated good" : "Good"}
        aria-pressed={feedbackLabel === "good"}
      >
        <ThumbsUp size={11} />
      </button>
      <button
        className={`chat-rate-btn ${feedbackLabel === "bad" ? "chat-rate-btn-active" : ""}`}
        type="button"
        onClick={(e) => { e.stopPropagation(); openMessageFeedback(msg, "bad"); }}
        title={feedbackLabel === "bad" ? "Rated bad" : "Bad"}
        aria-pressed={feedbackLabel === "bad"}
      >
        <ThumbsDown size={11} />
      </button>
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
        <div className="chat-trace-steps chat-trace-steps-current" aria-label="Assistant working">
          {conversationId && (
            <a href={`/queues?conversation=${encodeURIComponent(conversationId)}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>
              View full queue history →
            </a>
          )}
          <div className="chat-trace-step-wrap chat-trace-step-wrap-left" style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", gap: "0.5rem" }}>
            <LogoLoading size={20} className="chat-bubble-logo-loading" aria-hidden />
            <span className="chat-trace-step">
              {getLoadingStatus(msg as Parameters<typeof getLoadingStatus>[0])}
            </span>
          </div>
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
        const isRetrying = showError && loading && messages[index + 1]?.role === "user" && messages[index + 1]?.content === lastUserMessage;
        const errorText = msg.content.startsWith("Error: ") ? msg.content.slice(6).trim() : msg.content;
        return (
          <>
            {showError ? (
              <div className="chat-msg-error-placeholder">
                {isRetrying ? (
                  <p className="chat-section-error-retrying">
                    <Loader size={14} className="spin" aria-hidden />
                    Retrying…
                  </p>
                ) : (
                  <>
                    <p>{errorText || "An error occurred."}</p>
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
                  </>
                )}
              </div>
            ) : (displayState.displayContent.trim() !== "" || displayState.structuredContent) ? (
              <>
                <ChatMessageContent content={displayState.displayContent} structuredContent={displayState.structuredContent} />
                {displayState.hasAskUserWaiting && isLastMessage && !loading && (() => {
                  const opts = msg.interactivePrompt?.options && msg.interactivePrompt.options.length > 0
                    ? msg.interactivePrompt.options.map((s) => ({ value: s, label: s }))
                    : getSuggestedOptionsFromToolResults(list, displayState.displayContent || "");
                  if (opts.length === 0) return null;
                  const sendingForThisMsg = optionSending?.messageId === msg.id;
                  return (
                    <div className="chat-inline-options" role="group" aria-label="Choose an option">
                      <span className="chat-inline-options-label">Choose an option:</span>
                      <ul className="chat-inline-options-list">
                        {opts.map((opt, optIndex) => {
                          const isSendingThis = sendingForThisMsg && optionSending?.label === opt.label;
                          return (
                            <li key={`option-${optIndex}-${opt.value}`}>
                              <button
                                type="button"
                                className="chat-inline-option-btn"
                                onClick={() => {
                                  setOptionSending({ messageId: msg.id, label: opt.label });
                                  void send(undefined, opt.label);
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
                })()}
              </>
            ) : null}
          </>
        );
      })()}
      {msg.role === "assistant" && (() => {
        const agentRequest = getAgentRequestFromToolResults(list);
        if (!agentRequest || (!agentRequest.question && agentRequest.options.length === 0)) return null;
        return (
          <div className="chat-history-agent-request" style={{ marginTop: "0.75rem" }}>
            <AgentRequestBlock
              question={agentRequest.question || undefined}
              options={agentRequest.options}
              viewRunHref={`/runs/${agentRequest.runId}`}
              showVagueHint={false}
            />
          </div>
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
  const [messageFeedback, setMessageFeedback] = useState<{ msg: Message; label: "good" | "bad" } | null>(null);
  const [messageFeedbackSubmitting, setMessageFeedbackSubmitting] = useState(false);
  const [feedbackByContentKey, setFeedbackByContentKey] = useState<Record<string, "good" | "bad">>({});
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [providers, setProviders] = useState<LlmProvider[]>([]);
  const [providerId, setProviderId] = useState<string>("");
  const [chatMode, setChatMode] = useState<"traditional" | "heap">("traditional");
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
  const [runWaiting, setRunWaiting] = useState(false);
  const [runWaitingData, setRunWaitingData] = useState<{ runId: string; question?: string; options?: string[] } | null>(null);
  /** Option label currently being sent from the "What the agent needs" card; cleared when loading becomes false. */
  const [runWaitingOptionSending, setRunWaitingOptionSending] = useState<string | null>(null);
  /** When set, an option was just clicked for this message; show loading on that option and disable others until send completes. */
  const [optionSending, setOptionSending] = useState<{ messageId: string; label: string } | null>(null);
  const CHAT_DEFAULT_PROVIDER_KEY = "chat-default-provider-id";
  const CHAT_MODE_KEY = "chat-mode";
  const scrollRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loadingStartedAtRef = useRef<number | null>(null);
  const minLoadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevConversationIdRef = useRef<string | null>(null);
  const prevOpenRef = useRef(false);
  const lockVaultBtnRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const lastLocalInputChangeAtRef = useRef<number>(0);
  const currentInputRef = useRef(input);
  const crossTabStateRef = useRef<{ messageCount: number; loading: boolean }>({ messageCount: 0, loading: false });
  currentInputRef.current = input;

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

  const feedbackContentKey = useCallback((prev: string, out: string) => `${prev}\n\x00\n${out}`, []);

  // Load chat feedback and map by (input, output) so thumb state survives restore / message replace
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

  // Debounced draft save so text typed in the FAB is visible on the /chat page (shared storage)
  useEffect(() => {
    if (!conversationId) return;
    const t = setTimeout(() => {
      setDraft(conversationId, input);
    }, 400);
    return () => clearTimeout(t);
  }, [conversationId, input]);

  // When modal opens, sync input from shared draft (e.g. text typed on /chat page)
  useEffect(() => {
    if (open && !prevOpenRef.current && conversationId) {
      setInput(getDraft(conversationId));
      lastLocalInputChangeAtRef.current = Date.now();
    }
    prevOpenRef.current = open;
  }, [open, conversationId]);

  // When modal closes, save draft immediately (including empty so user can clear/delete the draft)
  useEffect(() => {
    if (!open && conversationId) {
      setDraft(conversationId, input);
    }
  }, [open, conversationId, input]);

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

  // Fetch conversation list when opening; if no conversation selected, prefer last-active or first
  useEffect(() => {
    if (open) {
      fetch("/api/chat/conversations", { cache: "no-store" })
        .then((r) => r.json())
        .then((data) => {
          const list = Array.isArray(data) ? data : [];
          setConversationList(list);
          if (!conversationId && !initialConversationId) {
            if (list.length > 0) {
              const lastActive = getLastActiveConversationId();
              const id = lastActive && list.some((c: { id: string }) => c.id === lastActive) ? lastActive : list[0].id;
              setConversationId(id);
            } else setLoaded(true);
          }
        })
        .catch(() => {
          setConversationList([]);
          if (!conversationId) setLoaded(true);
        });
    }
  }, [open]);

  // Load messages when conversationId changes: restore from shared cache first (thinking state), then background-fetch
  useEffect(() => {
    if (!conversationId) return;
    const restored = loadChatState(conversationId);
    if (restored) {
      setMessages(restored.messages as Message[]);
      const isFresh = Date.now() - restored.timestamp <= LOADING_FRESH_MS;
      setLoading(restored.loading && isFresh);
      if (restored.runWaiting != null && typeof restored.runWaiting === "object" && typeof (restored.runWaiting as { runId: string }).runId === "string") {
        setRunWaiting(true);
        setRunWaitingData(restored.runWaiting as { runId: string; question?: string; options?: string[] });
      }
      setLoaded(true);
      // Background fetch: prefer API when same or more messages so refresh/open always shows latest
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
            } as Message;
          });
          const useApi = apiMessages.length >= restored.messages.length;
          if (useApi) {
            setMessages(apiMessages);
            setLoading(false);
          }
        })
        .catch(() => {});
      return;
    }
    setLoaded(false);
    fetch(`/api/chat?conversationId=${encodeURIComponent(conversationId)}`, { cache: "no-store" })
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
          setLoading(false);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [conversationId]);

  // Persist messages, loading, and draft (debounced; broadcasts to other tabs via BroadcastChannel)
  const persistDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!open || !conversationId) return;
    if (persistDebounceRef.current) clearTimeout(persistDebounceRef.current);
    persistDebounceRef.current = setTimeout(() => {
      persistDebounceRef.current = null;
      saveChatState(conversationId, messages, loading, input);
    }, 600);
    return () => {
      if (persistDebounceRef.current) clearTimeout(persistDebounceRef.current);
    };
  }, [open, conversationId, messages, loading, input]);

  // Cross-tab: when another tab updates the cache, show updated thinking state (throttled to avoid glitching)
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
      if (state.loading && !data.loading && msgCount <= state.messageCount) return;
      if (!state.loading && data.loading && msgCount <= state.messageCount) return;
      crossTabApplyRef.current = { conversationId: cid, timestamp: data.timestamp, appliedAt: now };
      const isFresh = now - data.timestamp <= LOADING_FRESH_MS;
      const nextLoading = data.loading && isFresh;
      crossTabStateRef.current = { messageCount: msgCount, loading: nextLoading };
      setMessages(data.messages as Message[]);
      setLoading(nextLoading);
      if (data.draft !== undefined) {
        const idleMs = 2000;
        if (currentInputRef.current === "" || now - lastLocalInputChangeAtRef.current > idleMs) setInput(data.draft);
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

  const fetchRunWaiting = useCallback(() => {
    if (!open || !conversationId) return;
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
          setRunWaiting(true);
          setRunWaitingData(data);
          setRunWaitingInCache(conversationId, data);
          if (runId && (!data.question?.trim() || (Array.isArray(data.options) && data.options.length === 0))) {
            fetch(`/api/runs/${encodeURIComponent(runId)}/agent-request`, { cache: "no-store" })
              .then((ar) => (ar.ok ? ar.json() : null))
              .then((payload: { question?: string; options?: string[] } | null) => {
                if (!payload) return;
                const question = typeof payload.question === "string" && payload.question.trim() ? payload.question.trim() : undefined;
                const options = Array.isArray(payload.options) ? payload.options : [];
                if (question || options.length > 0) {
                  setRunWaitingData((prev) =>
                    prev?.runId === runId && prev ? { runId: prev.runId, question: question ?? prev.question, options: options.length > 0 ? options : (prev.options ?? []) } : prev
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
        }
      })
      .catch(() => {
        setRunWaiting(false);
        setRunWaitingData(null);
        setRunWaitingInCache(conversationId, null);
      });
  }, [open, conversationId]);

  useEffect(() => {
    if (!open || !conversationId) {
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
    const interval = setInterval(fetchRunWaiting, 3000);
    return () => clearInterval(interval);
  }, [open, conversationId, fetchRunWaiting]);

  // When we have a waiting run but no question (e.g. from cache or run started outside chat), fetch agent-request by run ID
  useEffect(() => {
    const data = runWaitingData;
    if (!data?.runId) return;
    const noRealQuestion =
      !data.question ||
      data.question.trim() === "" ||
      data.question === "The agent is waiting for your input.";
    if (!noRealQuestion) return;
    let cancelled = false;
    fetch(`/api/runs/${encodeURIComponent(data.runId)}/agent-request`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((payload: { question?: string; options?: string[] } | null) => {
        if (cancelled || !payload) return;
        const question = typeof payload.question === "string" && payload.question.trim() ? payload.question.trim() : undefined;
        const options = Array.isArray(payload.options) ? payload.options : [];
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
    if (typeof window === "undefined") return;
    try {
      const s = localStorage.getItem(CHAT_MODE_KEY);
      if (s === "heap") setChatMode("heap");
    } catch {
      // ignore
    }
  }, []);
  const handleChatModeChange = useCallback((mode: "traditional" | "heap") => {
    setChatMode(mode);
    try {
      localStorage.setItem(CHAT_MODE_KEY, mode);
    } catch {
      // ignore
    }
  }, []);

  const lastMsg = messages[messages.length - 1];
  const lastTraceSteps = lastMsg?.role === "assistant" ? lastMsg.traceSteps : undefined;
  const lastTracePhase = lastTraceSteps?.length ? lastTraceSteps[lastTraceSteps.length - 1].phase : undefined;
  // Unstick: if last message has a "done" trace step but loading is still true (e.g. "done" event missed), clear loading
  useEffect(() => {
    if (loading && lastMsg?.role === "assistant" && lastTracePhase === "done") {
      setLoading(false);
      crossTabStateRef.current = { ...crossTabStateRef.current, loading: false };
    }
  }, [loading, lastMsg?.role, lastTracePhase]);
  // Clear option-sending state when request finishes so buttons are clickable again
  useEffect(() => {
    if (!loading) {
      setOptionSending(null);
      setRunWaitingOptionSending(null);
    }
  }, [loading]);
  // Only auto-scroll when we're actively streaming (loading + assistant last), not on every messages update (refetch/cross-tab would scroll away)
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
    const sendingFromAgentRequestCard = optionValue !== undefined && runWaitingData != null;
    if (!sendingFromAgentRequestCard) {
      setRunWaiting(false);
      setRunWaitingData(null);
    }
    if (!isCredentialReply && optionValue === undefined && !extraBody?.continueShellApproval) {
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

    const buildBody = (base: Record<string, unknown>) => {
      const body = { ...base };
      if (isCredentialReply && credentialPayload) body.credentialResponse = credentialPayload;
      if (attachedContext) {
        body.attachedContext = attachedContext;
        clearAttachedContext?.();
      }
      body.useHeapMode = chatMode === "heap";
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
      setLoading: setLoadingWithMinDisplay,
      abortSignal: abortRef.current?.signal,
      randomId,
      normalizeToolResults,
      buildBody,
      extraBody,
      onRunFinished: (runId, status, details) => {
        if (status === "waiting_for_user") {
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
      },
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
              sendingOption={runWaitingOptionSending}
              onReplyOption={(value) => {
                setRunWaitingOptionSending(value);
                send(undefined, value);
              }}
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
                  setLoading(false);
                } catch {
                  // ignore
                }
              }}
              showVagueHint
            />
          )}
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
        {/* Model + Mode options */}
        <div className="chat-input-options">
          <select
            className="chat-provider-select"
            value={providerId}
            onChange={handleProviderChange}
            title="Select model"
            aria-label="Model"
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
          <div className="chat-mode-segments" role="group" aria-label="Mode">
            <button
              type="button"
              className={`chat-mode-segment${chatMode === "traditional" ? " chat-mode-segment-active" : ""}`}
              onClick={() => handleChatModeChange("traditional")}
              title="Traditional: single assistant"
            >
              <Bot size={14} aria-hidden />
              <span>Traditional</span>
            </button>
            <button
              type="button"
              className={`chat-mode-segment${chatMode === "heap" ? " chat-mode-segment-active" : ""}`}
              onClick={() => handleChatModeChange("heap")}
              title="Heap: multi-agent (router + specialists)"
            >
              <Network size={14} aria-hidden />
              <span>Heap</span>
            </button>
          </div>
        </div>
        {/* Input */}
        <div className="chat-input-bar">
          <textarea
            ref={inputRef}
            className="chat-input chat-input-textarea"
            placeholder="Message assistant... (Shift+Enter for new line)"
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
      {messageFeedback && (
        <div className="chat-feedback-modal-portal">
          <MessageFeedbackModal
            open
            onClose={closeMessageFeedback}
            label={messageFeedback.label}
            onSubmit={submitMessageFeedback}
            submitting={messageFeedbackSubmitting}
          />
        </div>
      )}
    </>
  );
}
