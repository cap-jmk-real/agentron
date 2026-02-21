"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { flushSync } from "react-dom";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Loader,
  Loader2,
  MessageSquarePlus,
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
  ChevronDown,
  ChevronRight,
  RotateCw,
} from "lucide-react";
import { hasAskUserWaitingForInput, normalizeToolResults } from "./chat-message-content";
import { performChatStreamSend } from "../hooks/useChatStream";
import { NOTIFICATIONS_UPDATED_EVENT } from "../lib/notifications-events";

/** Minimum time (ms) to show the loading status bar after sending (so option clicks show visible feedback). */
const MIN_LOADING_DISPLAY_MS = 600;

import ChatFeedbackModal from "./chat-feedback-modal";
import MessageFeedbackModal from "./message-feedback-modal";
import {
  loadChatState,
  saveChatState,
  shouldSkipLoadingFalseFromOtherTab,
  subscribeToChatStateChanges,
  getRunWaiting as getRunWaitingFromCache,
  setRunWaiting as setRunWaitingInCache,
  LOADING_FRESH_MS,
  getLastActiveConversationId,
} from "../lib/chat-state-cache";
import { getDraft, setDraft } from "../lib/chat-drafts";
import { getConversationIdFromSearchParams } from "../lib/chat-url-params";
import { randomId, getUiContext, getMessageCopyText } from "./chat-modal-utils";
import { ChatSectionMain } from "./chat-section-main";
import { ChatSectionSidebar } from "./chat-section-sidebar";
import type { Message, ToolResult, InteractivePrompt } from "./chat-types";

type ConversationItem = {
  id: string;
  title: string | null;
  rating: number | null;
  note: string | null;
  createdAt: number;
};
type LlmProvider = { id: string; provider: string; model: string; endpoint?: string };

type Props = {
  onOpenSettings?: () => void;
};

export default function ChatSection({ onOpenSettings }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const replyToRunId = searchParams.get("runId")?.trim() || undefined;
  const conversationFromUrl = getConversationIdFromSearchParams((k) => searchParams.get(k));
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(conversationFromUrl);
  const [conversationList, setConversationList] = useState<ConversationItem[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [messageFeedback, setMessageFeedback] = useState<{
    msg: Message;
    label: "good" | "bad";
  } | null>(null);
  const [messageFeedbackSubmitting, setMessageFeedbackSubmitting] = useState(false);
  const [feedbackByContentKey, setFeedbackByContentKey] = useState<Record<string, "good" | "bad">>(
    {}
  );
  const [providers, setProviders] = useState<LlmProvider[]>([]);
  const [providerId, setProviderId] = useState("");
  const [chatMode, setChatMode] = useState<"traditional" | "heap">("traditional");
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [collapsedStepsByMsg, setCollapsedStepsByMsg] = useState<Record<string, boolean>>({});
  const [runFinishedNotification, setRunFinishedNotification] = useState<{
    runId: string;
    status: string;
  } | null>(null);
  const [shellCommandLoading, setShellCommandLoading] = useState(false);
  const [pendingInputIds, setPendingInputIds] = useState<Set<string>>(new Set());
  const [runWaiting, setRunWaiting] = useState(false);
  const [runWaitingData, setRunWaitingData] = useState<{
    runId: string;
    question?: string;
    options?: string[];
  } | null>(null);
  /** Option label currently being sent from the "What the agent needs" card; cleared when loading becomes false. */
  const [runWaitingOptionSending, setRunWaitingOptionSending] = useState<string | null>(null);
  /** When set, an option was just clicked for this message; show loading on that option and disable others until send completes. */
  const [optionSending, setOptionSending] = useState<{ messageId: string; label: string } | null>(
    null
  );

  const CHAT_DEFAULT_PROVIDER_KEY = "chat-default-provider-id";
  const CHAT_MODE_KEY = "chat-mode";
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const prevConversationIdRef = useRef<string | null>(null);
  const crossTabStateRef = useRef<{ messageCount: number; loading: boolean }>({
    messageCount: 0,
    loading: false,
  });
  const loadingStartedAtRef = useRef<number | null>(null);
  const minLoadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** When the user last changed the input (keystroke); used to avoid overwriting with stale draft from broadcast. */
  const lastLocalInputChangeAtRef = useRef<number>(0);
  /** Current input value so broadcast handler can read latest without stale closure. */
  const currentInputRef = useRef(input);
  currentInputRef.current = input;
  /** Latest message count so load effect's background fetch does not overwrite when we have more messages (e.g. in-progress turn). */
  const latestMessageCountRef = useRef(0);
  latestMessageCountRef.current = messages.length;
  /** Current conversationId so notification-driven refetch can read latest without stale closure. */
  const conversationIdRef = useRef<string | null>(conversationId);
  conversationIdRef.current = conversationId;

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
    fetch("/api/chat/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.id) {
          setConversationId(data.id);
          setMessages([]);
          setConversationList((prev) => [
            { id: data.id, title: null, rating: null, note: null, createdAt: Date.now() },
            ...prev,
          ]);
        }
      })
      .catch(() => {});
  }, []);

  const deleteConversation = useCallback(
    async (id: string, e: React.MouseEvent) => {
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
    },
    [conversationId, conversationList, startNewChat]
  );

  const fetchConversationList = useCallback(() => {
    fetch("/api/chat/conversations", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setConversationList(list);
        setConversationId((current) => {
          if (!current && list.length > 0) {
            const lastActive = getLastActiveConversationId();
            if (lastActive && list.some((c: { id: string }) => c.id === lastActive))
              return lastActive;
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

  useEffect(() => {
    if (conversationFromUrl) setConversationId(conversationFromUrl);
  }, [conversationFromUrl]);

  // Content key for matching feedback to messages (stable across restore/API replace)
  const feedbackContentKey = useCallback(
    (prev: string, out: string) => `${prev}\n\x00\n${out}`,
    []
  );

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
    const fetchPendingFromNotifications = () => {
      fetch("/api/notifications?status=active&types=chat&limit=100")
        .then((r) => r.json())
        .then((d) => {
          const items = Array.isArray(d.items) ? d.items : [];
          setPendingInputIds(new Set(items.map((n: { sourceId: string }) => n.sourceId)));
        })
        .catch(() => setPendingInputIds(new Set()));
    };
    fetchPendingFromNotifications();
    const interval = setInterval(fetchPendingFromNotifications, 5000);
    const onUpdated = () => {
      fetchPendingFromNotifications();
    };
    window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, onUpdated);
    return () => {
      clearInterval(interval);
      window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, onUpdated);
    };
  }, []);

  const fetchRunWaiting = useCallback(() => {
    if (!conversationId) return;
    fetch(`/api/chat/run-waiting?conversationId=${encodeURIComponent(conversationId)}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.runWaiting === true) {
          const runId = d.runId ?? "";
          const data = {
            runId,
            question: d.question,
            options: Array.isArray(d.options) ? d.options : [],
          };
          const willFetchAgentRequest = !!(
            runId &&
            (!data.question?.trim() || (Array.isArray(data.options) && data.options.length === 0))
          );
          // #region agent log
          fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              location: "chat-section:fetchRunWaiting",
              message: "run-waiting true",
              data: {
                runId,
                questionLen: data.question?.length ?? 0,
                optionsLen: data.options?.length ?? 0,
                willFetchAgentRequest,
              },
              hypothesisId: "H1",
              timestamp: Date.now(),
            }),
          }).catch(() => {});
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
                const question =
                  typeof payload.question === "string" && payload.question.trim()
                    ? payload.question.trim()
                    : undefined;
                const options = Array.isArray(payload.options) ? payload.options : [];
                // #region agent log
                fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    location: "chat-section:agent-request-then",
                    message: "agent-request response",
                    data: {
                      runId,
                      questionLen: question?.length ?? 0,
                      optionsLen: options.length,
                      willMerge: !!(question || options.length > 0),
                    },
                    hypothesisId: "H4",
                    timestamp: Date.now(),
                  }),
                }).catch(() => {});
                // #endregion
                if (question || options.length > 0) {
                  setRunWaitingData((prev) =>
                    prev?.runId === runId && prev
                      ? {
                          runId: prev.runId,
                          question: question ?? prev.question,
                          options: options.length > 0 ? options : (prev.options ?? []),
                        }
                      : prev
                  );
                  setRunWaitingInCache(conversationId, {
                    runId,
                    question,
                    options: options.length > 0 ? options : (data.options ?? []),
                  });
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

  useEffect(() => {
    const syncRunBannerFromNotifications = () => {
      fetch("/api/notifications?status=active&types=run&limit=1")
        .then((r) => r.json())
        .then((d) => {
          const items = Array.isArray(d.items) ? d.items : [];
          if (items.length === 0) {
            setRunFinishedNotification(null);
            return;
          }
          const first = items[0];
          const runId = first.sourceId;
          const status =
            first.title && first.title.includes("needs your input")
              ? "waiting_for_user"
              : first.title && first.title.includes("failed")
                ? "failed"
                : "completed";
          setRunFinishedNotification((prev) => (prev?.runId === runId ? prev : { runId, status }));
          fetch(`/api/runs/${encodeURIComponent(runId)}`, { cache: "no-store" })
            .then((res) => (res.ok ? res.json() : null))
            .then((run: { conversationId?: string | null } | null) => {
              const runConvId = run?.conversationId ?? null;
              if (runConvId && runConvId === conversationIdRef.current) {
                fetch(`/api/chat?conversationId=${encodeURIComponent(runConvId)}`, {
                  cache: "no-store",
                })
                  .then((r) => r.json())
                  .then((data) => {
                    if (!Array.isArray(data)) return;
                    const apiMessages = data.map((m: Record<string, unknown>) => {
                      const raw = m.toolCalls;
                      const toolResults = (
                        Array.isArray(raw) ? normalizeToolResults(raw) : undefined
                      ) as ToolResult[] | undefined;
                      return {
                        id: m.id as string,
                        role: m.role as "user" | "assistant",
                        content: m.content as string,
                        toolResults,
                        ...(m.status !== undefined && {
                          status: m.status as "completed" | "waiting_for_input",
                        }),
                        ...(m.interactivePrompt != null && {
                          interactivePrompt: m.interactivePrompt as InteractivePrompt,
                        }),
                        ...(m.todos != null && { todos: m.todos as string[] }),
                        ...(m.completedStepIndices != null && {
                          completedStepIndices: m.completedStepIndices as number[],
                        }),
                      } as Message;
                    });
                    setMessages((prev) => {
                      const skip = apiMessages.length < prev.length;
                      const lastPrev = prev[prev.length - 1];
                      const lastApi = apiMessages[apiMessages.length - 1];
                      const localRicher =
                        lastPrev?.role === "assistant" &&
                        lastApi?.role === "assistant" &&
                        (lastPrev.content ?? "").trim().length > 0 &&
                        (lastApi.content ?? "").trim().length === 0;
                      if (skip || localRicher) return prev;
                      return apiMessages;
                    });
                  })
                  .catch(() => {});
              }
            })
            .catch(() => {});
        })
        .catch(() => {});
    };
    syncRunBannerFromNotifications();
    const interval = setInterval(syncRunBannerFromNotifications, 10_000);
    const onUpdated = () => {
      syncRunBannerFromNotifications();
    };
    window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, onUpdated);
    return () => {
      clearInterval(interval);
      window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, onUpdated);
    };
  }, []);

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
    fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location: "chat-section:backfill-effect",
        message: "backfill running",
        data: { runId: data.runId },
        hypothesisId: "H4",
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    let cancelled = false;
    fetch(`/api/runs/${encodeURIComponent(data.runId)}/agent-request`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((payload: { question?: string; options?: string[] } | null) => {
        if (cancelled || !payload) return;
        const question =
          typeof payload.question === "string" && payload.question.trim()
            ? payload.question.trim()
            : undefined;
        const options = Array.isArray(payload.options) ? payload.options : [];
        // #region agent log
        fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            location: "chat-section:backfill-then",
            message: "backfill agent-request response",
            data: {
              runId: data.runId,
              questionLen: question?.length ?? 0,
              optionsLen: options.length,
            },
            hypothesisId: "H4",
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
        if (question || options.length > 0) {
          setRunWaitingData((prev) =>
            prev?.runId === data.runId
              ? {
                  ...prev,
                  question: question ?? prev?.question,
                  options: options.length > 0 ? options : (prev?.options ?? []),
                }
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
      if (typeof fetch !== "undefined")
        fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "26876c" },
          body: JSON.stringify({
            sessionId: "26876c",
            location: "chat-section:apply_restored",
            message: "apply restored cache",
            data: { msgLen: restored.messages.length, loading: restored.loading },
            hypothesisId: "H4",
            timestamp: Date.now(),
          }),
        }).catch(() => {});
      // #endregion
      const isFresh = Date.now() - restored.timestamp <= LOADING_FRESH_MS;
      const restoredLoading = restored.loading && isFresh;
      crossTabStateRef.current = {
        messageCount: restored.messages.length,
        loading: restoredLoading,
      };
      setMessages(restored.messages as Message[]);
      setLoading(restoredLoading);
      if (
        restored.runWaiting != null &&
        typeof restored.runWaiting === "object" &&
        typeof (restored.runWaiting as { runId: string }).runId === "string"
      ) {
        setRunWaiting(true);
        setRunWaitingData(
          restored.runWaiting as { runId: string; question?: string; options?: string[] }
        );
      }
      setLoaded(true);
      // Background fetch: API is source of truth so updates are visible after refresh
      fetch(`/api/chat?conversationId=${encodeURIComponent(conversationId)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((data) => {
          if (!Array.isArray(data)) return;
          const apiMessages = data.map((m: Record<string, unknown>) => {
            const raw = m.toolCalls;
            const toolResults = (Array.isArray(raw) ? normalizeToolResults(raw) : undefined) as
              | ToolResult[]
              | undefined;
            return {
              id: m.id as string,
              role: m.role as "user" | "assistant",
              content: m.content as string,
              toolResults,
              ...(m.status !== undefined && {
                status: m.status as "completed" | "waiting_for_input",
              }),
              ...(m.interactivePrompt != null && {
                interactivePrompt: m.interactivePrompt as InteractivePrompt,
              }),
              ...(m.todos != null && { todos: m.todos as string[] }),
              ...(m.completedStepIndices != null && {
                completedStepIndices: m.completedStepIndices as number[],
              }),
            } as Message;
          });
          // Prefer API when it has at least as many messages as we had at restore; do not overwrite when we have more messages locally (in-progress or just-finished turn)
          const currentCount = latestMessageCountRef.current;
          const useApi =
            apiMessages.length >= restored.messages.length && apiMessages.length >= currentCount;
          const lastRestored = restored.messages[restored.messages.length - 1];
          const lastApi = apiMessages[apiMessages.length - 1];
          const localRicher =
            lastRestored?.role === "assistant" &&
            lastApi?.role === "assistant" &&
            (lastRestored.content ?? "").trim().length > 0 &&
            (lastApi.content ?? "").trim().length === 0;
          if (useApi && !localRicher) {
            crossTabStateRef.current = { messageCount: apiMessages.length, loading: false };
            setMessages(apiMessages);
            setLoading(false);
          }
        })
        .catch(() => {});
      return;
    }
    const currentCountAtStart = latestMessageCountRef.current;
    // #region agent log
    if (typeof fetch !== "undefined")
      fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "ce22a5" },
        body: JSON.stringify({
          sessionId: "ce22a5",
          location: "chat-section:load_no_cache",
          message: "load effect no cache, fetching",
          data: { conversationId, currentCount: currentCountAtStart },
          hypothesisId: "H1",
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    // #endregion
    // When we already have optimistic messages (e.g. just sent: user + placeholder), don't set loaded false so persist keeps running and UI doesn't flicker
    if (currentCountAtStart < 2) setLoaded(false);
    fetch(`/api/chat?conversationId=${encodeURIComponent(conversationId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (!Array.isArray(data)) return;
        const currentCount = latestMessageCountRef.current;
        const useApi = data.length >= currentCount;
        // #region agent log
        if (typeof fetch !== "undefined")
          fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "ce22a5" },
            body: JSON.stringify({
              sessionId: "ce22a5",
              location: "chat-section:load_no_cache_set",
              message: "no-cache fetch result",
              data: { apiLen: data.length, currentCount, useApi },
              hypothesisId: "H1",
              timestamp: Date.now(),
            }),
          }).catch(() => {});
        // #endregion
        if (!useApi) {
          setLoaded(true);
          return;
        }
        const msgs = data.map((m: Record<string, unknown>) => {
          const raw = m.toolCalls;
          const toolResults = (Array.isArray(raw) ? normalizeToolResults(raw) : undefined) as
            | ToolResult[]
            | undefined;
          return {
            id: m.id as string,
            role: m.role as "user" | "assistant",
            content: m.content as string,
            toolResults,
            ...(m.status !== undefined && {
              status: m.status as "completed" | "waiting_for_input",
            }),
            ...(m.interactivePrompt != null && {
              interactivePrompt: m.interactivePrompt as InteractivePrompt,
            }),
            ...(m.todos != null && { todos: m.todos as string[] }),
            ...(m.completedStepIndices != null && {
              completedStepIndices: m.completedStepIndices as number[],
            }),
          } as Message;
        });
        let applied = false;
        setMessages((prev) => {
          const lastPrev = prev[prev.length - 1];
          const lastApi = msgs[msgs.length - 1];
          const localRicher =
            lastPrev?.role === "assistant" &&
            lastApi?.role === "assistant" &&
            (lastPrev.content ?? "").trim().length > 0 &&
            (lastApi.content ?? "").trim().length === 0;
          if (localRicher) return prev;
          applied = true;
          return msgs;
        });
        crossTabStateRef.current = {
          messageCount: applied ? msgs.length : latestMessageCountRef.current,
          loading: false,
        };
        setLoading(false);
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
      if (typeof fetch !== "undefined")
        fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            location: "chat-section:persist",
            message: "saveChatState",
            data: { msgLen: messages.length, loading },
            hypothesisId: "H3",
            timestamp: Date.now(),
          }),
        }).catch(() => {});
      // #endregion
      saveChatState(conversationId, messages, loading, input);
    }, 600);
    return () => {
      if (persistDebounceRef.current) clearTimeout(persistDebounceRef.current);
    };
  }, [conversationId, loaded, messages, loading, input]);

  // Cross-tab: when another tab updates the cache, show updated thinking state (throttled to avoid constant refresh)
  const crossTabApplyRef = useRef<{
    conversationId: string;
    timestamp: number;
    appliedAt: number;
  } | null>(null);
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
      if (shouldSkipLoadingFalseFromOtherTab(state, data.loading, msgCount)) return;
      // Don't apply stale "loading true" broadcast that would re-show spinner and overwrite completed response (stream finished in this tab, then old persist broadcasts)
      if (!state.loading && data.loading && msgCount <= state.messageCount) return;
      // #region agent log
      if (typeof fetch !== "undefined")
        fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            location: "chat-section:cross_tab",
            message: "cross-tab apply",
            data: { msgLen: data.messages?.length, loading: data.loading },
            hypothesisId: "H2",
            timestamp: Date.now(),
          }),
        }).catch(() => {});
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
        if (current === "" || now - lastLocalInputChangeAtRef.current > idleMs)
          setInput(data.draft);
      }
      if (data.runWaiting !== undefined) {
        const rw = data.runWaiting;
        if (
          rw != null &&
          typeof rw === "object" &&
          typeof (rw as { runId: string }).runId === "string"
        ) {
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

  const currentConversation = conversationId
    ? conversationList.find((c) => c.id === conversationId)
    : null;
  useEffect(() => {
    setNoteDraft(currentConversation?.note ?? "");
  }, [currentConversation?.id, currentConversation?.note]);

  const saveConversationRating = useCallback(
    async (rating: number | null) => {
      if (!conversationId) return;
      await fetch(`/api/chat/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating }),
      });
      setConversationList((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, rating } : c))
      );
    },
    [conversationId]
  );

  const saveConversationNote = useCallback(async () => {
    if (!conversationId) return;
    setSavingNote(true);
    try {
      await fetch(`/api/chat/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: noteDraft.trim() || null }),
      });
      setConversationList((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, note: noteDraft.trim() || null } : c))
      );
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
        const saved =
          typeof localStorage !== "undefined"
            ? localStorage.getItem(CHAT_DEFAULT_PROVIDER_KEY)
            : null;
        const valid = saved && list.some((p: LlmProvider) => p.id === saved);
        setProviderId(valid ? saved : (list[0]?.id ?? ""));
      })
      .catch(() => setProviders([]));
  }, []);

  const handleProviderChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setProviderId(value);
    if (typeof localStorage !== "undefined" && value)
      localStorage.setItem(CHAT_DEFAULT_PROVIDER_KEY, value);
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
  const lastTracePhase = lastTraceSteps?.length
    ? lastTraceSteps[lastTraceSteps.length - 1].phase
    : undefined;
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
    if (loading && lastMsg?.role === "assistant") {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [loading, lastTraceSteps, lastMsg?.role]);

  const stopRequest = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(
    async (textOverride?: string, extraBody?: Record<string, unknown>) => {
      const text = textOverride !== undefined ? textOverride : input.trim();
      if (!text || loading) return;
      abortRef.current?.abort();
      setRunFinishedNotification(null);
      const sendingFromAgentRequestCard = textOverride !== undefined && runWaitingData != null;
      if (!sendingFromAgentRequestCard) {
        setRunWaiting(false);
        setRunWaitingData(null);
      }
      if (textOverride === undefined && !extraBody?.continueShellApproval) {
        setInput("");
        if (conversationId) setDraft(conversationId, "");
      }
      const userMsg: Message = { id: randomId(), role: "user", content: text };
      const placeholderId = randomId();
      flushSync(() => {
        setMessages((prev) => [
          ...prev,
          userMsg,
          { id: placeholderId, role: "assistant", content: "" },
        ]);
      });
      // #region agent log
      if (typeof fetch !== "undefined")
        fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "26876c" },
          body: JSON.stringify({
            sessionId: "26876c",
            location: "chat-section:send_flushed",
            message: "send: flushed user+placeholder",
            data: {
              messagesLen: messages.length,
              placeholderId: placeholderId.slice(0, 8),
              conversationId: conversationId ?? null,
            },
            hypothesisId: "H2",
            timestamp: Date.now(),
          }),
        }).catch(() => {});
      // #endregion
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
        extraBody: {
          ...(replyToRunId && { runId: replyToRunId }),
          useHeapMode: chatMode === "heap",
          ...extraBody,
        },
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
              if (conversationId)
                setRunWaitingInCache(conversationId, {
                  runId,
                  question: details.question,
                  options: details.options,
                });
            }
            void fetchRunWaiting();
          } else {
            setRunFinishedNotification({ runId, status });
          }
          if (conversationId) {
            fetch(`/api/chat?conversationId=${encodeURIComponent(conversationId)}`, {
              cache: "no-store",
            })
              .then((r) => r.json())
              .then((data) => {
                if (!Array.isArray(data)) return;
                const apiMessages = data.map((m: Record<string, unknown>) => {
                  const raw = m.toolCalls;
                  const toolResults = (
                    Array.isArray(raw) ? normalizeToolResults(raw) : undefined
                  ) as ToolResult[] | undefined;
                  return {
                    id: m.id as string,
                    role: m.role as "user" | "assistant",
                    content: m.content as string,
                    toolResults,
                    ...(m.status !== undefined && {
                      status: m.status as "completed" | "waiting_for_input",
                    }),
                    ...(m.interactivePrompt != null && {
                      interactivePrompt: m.interactivePrompt as InteractivePrompt,
                    }),
                    ...(m.todos != null && { todos: m.todos as string[] }),
                    ...(m.completedStepIndices != null && {
                      completedStepIndices: m.completedStepIndices as number[],
                    }),
                  } as Message;
                });
                setMessages((prev) => {
                  const skip = apiMessages.length < prev.length;
                  const lastPrev = prev[prev.length - 1];
                  const lastApi = apiMessages[apiMessages.length - 1];
                  const localRicher =
                    lastPrev?.role === "assistant" &&
                    lastApi?.role === "assistant" &&
                    (lastPrev.content ?? "").trim().length > 0 &&
                    (lastApi.content ?? "").trim().length === 0;
                  if (skip || localRicher) return prev;
                  return apiMessages;
                });
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
    },
    [
      input,
      loading,
      messages,
      providerId,
      conversationId,
      pathname,
      replyToRunId,
      fetchRunWaiting,
      runWaitingData,
      chatMode,
    ]
  );

  const handleShellCommandApprove = useCallback(
    async (command: string) => {
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
    },
    [shellCommandLoading, loading, send]
  );

  const handleShellCommandAddToAllowlist = useCallback(
    async (command: string) => {
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
          const msg =
            added.length > 1
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
    },
    [shellCommandLoading, send]
  );

  const openMessageFeedback = useCallback((msg: Message, label: "good" | "bad") => {
    setMessageFeedback({ msg, label });
  }, []);

  const submitMessageFeedback = useCallback(
    async (notes: string) => {
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
    },
    [messageFeedback, messages, feedbackContentKey]
  );

  const closeMessageFeedback = useCallback(() => setMessageFeedback(null), []);

  const handleCancelRun = useCallback(async () => {
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
  }, [runWaitingData?.runId, conversationId]);

  return (
    <section className="chat-section">
      <ChatSectionSidebar
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        conversationList={conversationList}
        conversationId={conversationId}
        setConversationId={(id) => setConversationId(id)}
        loading={loading}
        messages={messages}
        pendingInputIds={pendingInputIds}
        deleteConversation={deleteConversation}
        startNewChat={startNewChat}
        onOpenSettings={onOpenSettings}
      />

      <ChatSectionMain
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        loaded={loaded}
        messages={messages}
        scrollRef={scrollRef}
        providers={providers}
        loading={loading}
        lastMsg={lastMsg}
        collapsedStepsByMsg={collapsedStepsByMsg}
        setCollapsedStepsByMsg={setCollapsedStepsByMsg}
        copiedMsgId={copiedMsgId}
        setCopiedMsgId={setCopiedMsgId}
        openMessageFeedback={openMessageFeedback}
        feedbackByContentKey={feedbackByContentKey}
        feedbackContentKey={feedbackContentKey}
        send={send}
        providerId={providerId}
        conversationId={conversationId}
        getMessageCopyText={getMessageCopyText}
        handleShellCommandApprove={handleShellCommandApprove}
        handleShellCommandAddToAllowlist={handleShellCommandAddToAllowlist}
        shellCommandLoading={shellCommandLoading}
        optionSending={optionSending}
        setOptionSending={setOptionSending}
        runWaiting={runWaiting}
        runWaitingData={runWaitingData}
        runWaitingOptionSending={runWaitingOptionSending}
        setRunWaitingOptionSending={setRunWaitingOptionSending}
        onCancelRun={handleCancelRun}
        runFinishedNotification={runFinishedNotification}
        setRunFinishedNotification={setRunFinishedNotification}
        handleProviderChange={handleProviderChange}
        chatMode={chatMode}
        handleChatModeChange={handleChatModeChange}
        inputRef={inputRef}
        input={input}
        setInput={setInput}
        lastLocalInputChangeAtRef={lastLocalInputChangeAtRef}
        resizeInput={resizeInput}
        stopRequest={stopRequest}
        setShowFeedbackModal={setShowFeedbackModal}
      />

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
