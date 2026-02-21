"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Send,
  ThumbsUp,
  ThumbsDown,
  Loader,
  Loader2,
  Copy,
  Check,
  Circle,
  CircleDot,
  Trash2,
  ExternalLink,
  Settings2,
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
import { randomId, getUiContext, getMessageCopyText } from "./chat-modal-utils";
import { ChatModalMain } from "./chat-modal-main";
import { ChatModalConversationsPanel } from "./chat-modal-conversations-panel";
import type { Message, ToolResult, InteractivePrompt } from "./chat-types";

type LlmProvider = { id: string; provider: string; model: string; endpoint?: string };

type ConversationItem = {
  id: string;
  title: string | null;
  rating: number | null;
  note: string | null;
  createdAt: number;
};

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

export default function ChatModal({
  open,
  onClose,
  embedded,
  attachedContext,
  clearAttachedContext,
  initialConversationId,
  clearInitialConversationId,
  onOpenStackTraces,
  onOpenSettings,
}: Props) {
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
  const [messageFeedback, setMessageFeedback] = useState<{
    msg: Message;
    label: "good" | "bad";
  } | null>(null);
  const [messageFeedbackSubmitting, setMessageFeedbackSubmitting] = useState(false);
  const [feedbackByContentKey, setFeedbackByContentKey] = useState<Record<string, "good" | "bad">>(
    {}
  );
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
  const crossTabStateRef = useRef<{ messageCount: number; loading: boolean }>({
    messageCount: 0,
    loading: false,
  });
  const latestMessageCountRef = useRef(0);
  currentInputRef.current = input;
  latestMessageCountRef.current = messages.length;

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

  const feedbackContentKey = useCallback(
    (prev: string, out: string) => `${prev}\n\x00\n${out}`,
    []
  );

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

  useEffect(() => {
    if (!open) return;
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
              const id =
                lastActive && list.some((c: { id: string }) => c.id === lastActive)
                  ? lastActive
                  : list[0].id;
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
      // Background fetch: prefer API when same or more messages so refresh/open always shows latest
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
            } as Message;
          });
          const currentCount = latestMessageCountRef.current;
          const useApi =
            apiMessages.length >= restored.messages.length && apiMessages.length >= currentCount;
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
        if (!Array.isArray(data)) return;
        const currentCount = latestMessageCountRef.current;
        const useApi = data.length >= currentCount;
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
          } as Message;
        });
        setMessages(msgs);
        setLoading(false);
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
      if (!state.loading && data.loading && msgCount <= state.messageCount) return;
      crossTabApplyRef.current = { conversationId: cid, timestamp: data.timestamp, appliedAt: now };
      const isFresh = now - data.timestamp <= LOADING_FRESH_MS;
      const nextLoading = data.loading && isFresh;
      crossTabStateRef.current = { messageCount: msgCount, loading: nextLoading };
      setMessages(data.messages as Message[]);
      setLoading(nextLoading);
      if (data.draft !== undefined) {
        const idleMs = 2000;
        if (currentInputRef.current === "" || now - lastLocalInputChangeAtRef.current > idleMs)
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

  const fetchRunWaiting = useCallback(() => {
    if (!open || !conversationId) return;
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
          setRunWaiting(true);
          setRunWaitingData(data);
          setRunWaitingInCache(conversationId, data);
          if (
            runId &&
            (!data.question?.trim() || (Array.isArray(data.options) && data.options.length === 0))
          ) {
            fetch(`/api/runs/${encodeURIComponent(runId)}/agent-request`, { cache: "no-store" })
              .then((ar) => (ar.ok ? ar.json() : null))
              .then((payload: { question?: string; options?: string[] } | null) => {
                if (!payload) return;
                const question =
                  typeof payload.question === "string" && payload.question.trim()
                    ? payload.question.trim()
                    : undefined;
                const options = Array.isArray(payload.options) ? payload.options : [];
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
        const question =
          typeof payload.question === "string" && payload.question.trim()
            ? payload.question.trim()
            : undefined;
        const options = Array.isArray(payload.options) ? payload.options : [];
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
          const saved =
            typeof localStorage !== "undefined"
              ? localStorage.getItem(CHAT_DEFAULT_PROVIDER_KEY)
              : null;
          const valid = saved && list.some((p: LlmProvider) => p.id === saved);
          setProviderId(valid ? saved : (list[0]?.id ?? ""));
        })
        .catch(() => setProviders([]));
    }
  }, [open]);

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

  const send = async (
    payload?: unknown,
    optionValue?: string,
    extraBody?: Record<string, unknown>
  ) => {
    const credentialPayload =
      payload != null &&
      typeof payload === "object" &&
      "credentialKey" in payload &&
      "value" in payload &&
      "save" in payload
        ? (payload as { credentialKey: string; value: string; save: boolean })
        : undefined;
    const isCredentialReply = credentialPayload != null;
    const text = isCredentialReply
      ? "Credentials provided."
      : optionValue !== undefined
        ? optionValue
        : input.trim();
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
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: placeholderId, role: "assistant", content: "" },
    ]);
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
            if (conversationId)
              setRunWaitingInCache(conversationId, {
                runId,
                question: details.question,
                options: details.options,
              });
          }
          void fetchRunWaiting();
        }
        if (conversationId) {
          fetch(`/api/chat?conversationId=${encodeURIComponent(conversationId)}`, {
            cache: "no-store",
          })
            .then((r) => r.json())
            .then((data) => {
              if (!Array.isArray(data)) return;
              const currentCount = latestMessageCountRef.current;
              if (data.length < currentCount) return;
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
                } as Message;
              });
              setMessages(msgs);
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
      },
      onInputRestore: !isCredentialReply ? (t) => setInput(t) : undefined,
    });
    abortRef.current = null;
  };

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
          send(undefined, msg);
        } else {
          send(undefined, `Failed to add to allowlist: ${data.error || "Unknown error"}`);
        }
      } catch {
        send(undefined, "Failed to add command to allowlist.");
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

  const conversationsContent = (
    <ChatModalConversationsPanel
      embedded={!!embedded}
      showConversationList={showConversationList}
      setShowConversationList={setShowConversationList}
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
  );

  const conversationsModal = !embedded && showConversationList && (
    <div className="chat-conversations-modal" role="dialog" aria-label="Chat history">
      <div
        className="chat-conversations-modal-backdrop"
        role="presentation"
        onClick={() => setShowConversationList(false)}
      />
      <div className="chat-conversations-modal-dialog">{conversationsContent}</div>
    </div>
  );

  const chatMain = (
    <ChatModalMain
      embedded={!!embedded}
      attachedContext={attachedContext}
      showConversationList={showConversationList}
      setShowConversationList={setShowConversationList}
      startNewChat={startNewChat}
      conversationId={conversationId}
      onClose={onClose}
      vaultLocked={vaultLocked}
      vaultExists={vaultExists}
      vaultPassword={vaultPassword}
      vaultError={vaultError}
      vaultLoading={vaultLoading}
      showVaultForm={showVaultForm}
      setShowVaultForm={setShowVaultForm}
      setVaultPassword={setVaultPassword}
      setVaultError={setVaultError}
      onVaultUnlock={handleVaultUnlock}
      onVaultLock={handleVaultLock}
      lockVaultBtnRef={lockVaultBtnRef}
      messages={messages}
      scrollRef={scrollRef}
      providers={providers}
      loading={loading}
      lastMsg={lastMsg}
      runWaiting={runWaiting}
      runWaitingData={runWaitingData}
      send={send}
      credentialInput={credentialInput}
      setCredentialInput={setCredentialInput}
      credentialSave={credentialSave}
      setCredentialSave={setCredentialSave}
      providerId={providerId}
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
      feedbackContentKey={feedbackContentKey}
      setCopiedMsgId={setCopiedMsgId}
      copiedMsgId={copiedMsgId}
      openMessageFeedback={openMessageFeedback}
      feedbackByContentKey={feedbackByContentKey}
      handleShellCommandApprove={handleShellCommandApprove}
      handleShellCommandAddToAllowlist={handleShellCommandAddToAllowlist}
      shellCommandLoading={shellCommandLoading}
      optionSending={optionSending}
      setOptionSending={setOptionSending}
      runWaitingOptionSending={runWaitingOptionSending}
      setRunWaitingOptionSending={setRunWaitingOptionSending}
      setRunWaiting={setRunWaiting}
      setRunWaitingData={setRunWaitingData}
      setRunWaitingInCache={setRunWaitingInCache}
      setLoading={setLoading}
      getMessageCopyText={getMessageCopyText}
    />
  );

  return (
    <>
      {open && !embedded && (
        <div className="chat-backdrop" ref={backdropRef} onClick={handleBackdropClick} />
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
        <div className={`chat-panel ${open ? "chat-panel-open" : ""}`}>{chatMain}</div>
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
