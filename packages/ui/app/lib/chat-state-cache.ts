"use client";

/**
 * Shared per-conversation chat state cache (localStorage for persistence/reload;
 * BroadcastChannel for cross-tab sync in browser; sessionStorage in Electron, no cross-tab).
 */

const CACHE_KEY = "agentron-chat-state-v1";
const BC_CHANNEL_NAME = "agentron-chat-state-sync";
const MAX_ENTRIES = 20;
const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes
export const LOADING_FRESH_MS = 90_000; // 90s: treat loading as "thinking" only if timestamp within this

/** Message shape compatible with chat-section and chat-modal (subset used for persistence). */
export type CachedMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolResults?: { name: string; args: Record<string, unknown>; result: unknown }[];
  status?: "completed" | "waiting_for_input";
  interactivePrompt?: { question: string; options?: string[] };
  reasoning?: string;
  todos?: string[];
  completedStepIndices?: number[];
  executingStepIndex?: number;
  executingToolName?: string;
  executingTodoLabel?: string;
  executingSubStepLabel?: string;
  rephrasedPrompt?: string | null;
  traceSteps?: {
    phase: string;
    label?: string;
    contentPreview?: string;
    inputPreview?: string;
    specialistId?: string;
    toolName?: string;
    toolInput?: unknown;
    toolOutput?: unknown;
  }[];
};

export type RunWaitingState = { runId: string; question?: string; options?: string[] };

export type CachedChatState = {
  messages: CachedMessage[];
  loading: boolean;
  timestamp: number;
  /** Current input draft for this conversation (shared with chat-section and FAB modal; synced across tabs when using localStorage). */
  draft?: string;
  /** When a workflow run is waiting for user input (same conversation): question and options surfaced in chat; synced across tabs. */
  runWaiting?: RunWaitingState | null;
};

type CachePayload = {
  entries: Record<string, CachedChatState>;
  lastActiveConversationId: string | null;
};

function isElectron(): boolean {
  return (
    typeof window !== "undefined" && Boolean((window as Window & { agentron?: unknown }).agentron)
  );
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return isElectron() ? sessionStorage : localStorage;
}

function readCache(): CachePayload {
  const storage = getStorage();
  if (!storage) return { entries: {}, lastActiveConversationId: null };
  try {
    const raw = storage.getItem(CACHE_KEY);
    if (!raw) return { entries: {}, lastActiveConversationId: null };
    const parsed = JSON.parse(raw) as CachePayload;
    if (!parsed || typeof parsed !== "object")
      return { entries: {}, lastActiveConversationId: null };
    return {
      entries: typeof parsed.entries === "object" && parsed.entries !== null ? parsed.entries : {},
      lastActiveConversationId:
        typeof parsed.lastActiveConversationId === "string" ||
        parsed.lastActiveConversationId === null
          ? parsed.lastActiveConversationId
          : null,
    };
  } catch {
    return { entries: {}, lastActiveConversationId: null };
  }
}

function writeCache(payload: CachePayload): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

function prune(entries: Record<string, CachedChatState>): Record<string, CachedChatState> {
  const now = Date.now();
  const ids = Object.entries(entries)
    .filter(([, v]) => v && now - (v.timestamp ?? 0) <= MAX_AGE_MS)
    .sort(([, a], [, b]) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
    .slice(0, MAX_ENTRIES)
    .map(([id]) => id);
  const next: Record<string, CachedChatState> = {};
  for (const id of ids) {
    if (entries[id]) next[id] = entries[id];
  }
  return next;
}

/**
 * Load cached state for a conversation. Returns null if missing or older than MAX_AGE_MS.
 * Includes draft when present.
 */
export function loadChatState(conversationId: string): CachedChatState | null {
  const { entries } = readCache();
  const entry = entries[conversationId];
  if (!entry || !entry.messages) return null;
  if (Date.now() - (entry.timestamp ?? 0) > MAX_AGE_MS) return null;
  return {
    messages: Array.isArray(entry.messages) ? entry.messages : [],
    loading: Boolean(entry.loading),
    timestamp: Number(entry.timestamp) || Date.now(),
    ...(typeof entry.draft === "string" && { draft: entry.draft }),
    ...(entry.runWaiting != null && { runWaiting: entry.runWaiting }),
  };
}

/**
 * Save state for a conversation and update last-active. Prunes old entries.
 * When using localStorage, also broadcasts to other tabs via BroadcastChannel.
 * Pass draft to merge current input draft into the saved state.
 */
export function saveChatState(
  conversationId: string,
  messages: CachedMessage[],
  loading: boolean,
  draft?: string
): void {
  const payload = readCache();
  const entries = { ...payload.entries };
  const timestamp = Date.now();
  const existing = entries[conversationId];
  const state: CachedChatState = {
    messages: Array.isArray(messages) ? messages : [],
    loading: Boolean(loading),
    timestamp,
    ...(draft !== undefined && { draft }),
    ...(existing?.runWaiting != null && { runWaiting: existing.runWaiting }),
  };
  entries[conversationId] = state;
  payload.entries = prune(entries);
  payload.lastActiveConversationId = conversationId;
  writeCache(payload);
  broadcastStateUpdate(conversationId, state);
}

/**
 * Get the current draft for a conversation from the message-state cache.
 */
export function getDraft(conversationId: string): string {
  const { entries } = readCache();
  const entry = entries[conversationId];
  return typeof entry?.draft === "string" ? entry.draft : "";
}

/**
 * Set the draft for a conversation (message-based: stored with conversation state, broadcast to other tabs).
 */
export function setDraft(conversationId: string, text: string): void {
  const storage = getStorage();
  if (!storage) return;
  const payload = readCache();
  const entries = { ...payload.entries };
  const timestamp = Date.now();
  const existing = entries[conversationId];
  const state: CachedChatState = {
    messages: Array.isArray(existing?.messages) ? existing.messages : [],
    loading: Boolean(existing?.loading),
    timestamp,
    ...(text.trim() ? { draft: text } : {}),
    ...(existing?.runWaiting != null && { runWaiting: existing.runWaiting }),
  };
  entries[conversationId] = state;
  payload.entries = prune(entries);
  payload.lastActiveConversationId = conversationId;
  writeCache(payload);
  broadcastStateUpdate(conversationId, state);
}

/**
 * Get run-waiting state for a conversation from the message-state cache (message-based, same store as draft/messages).
 */
export function getRunWaiting(conversationId: string): RunWaitingState | null {
  const { entries } = readCache();
  const entry = entries[conversationId];
  const rw = entry?.runWaiting;
  if (rw == null || typeof rw !== "object" || typeof (rw as RunWaitingState).runId !== "string")
    return null;
  return rw as RunWaitingState;
}

/**
 * Set run-waiting state for a conversation (message-based: stored with conversation state, broadcast to other tabs).
 * Pass null to clear (e.g. run resumed or cancelled).
 */
export function setRunWaiting(conversationId: string, data: RunWaitingState | null): void {
  const storage = getStorage();
  if (!storage) return;
  const payload = readCache();
  const entries = { ...payload.entries };
  const timestamp = Date.now();
  const existing = entries[conversationId];
  const state: CachedChatState = {
    messages: Array.isArray(existing?.messages) ? existing.messages : [],
    loading: Boolean(existing?.loading),
    timestamp,
    ...(typeof existing?.draft === "string" && { draft: existing.draft }),
    ...(data !== undefined && { runWaiting: data }),
  };
  entries[conversationId] = state;
  payload.entries = prune(entries);
  payload.lastActiveConversationId = conversationId;
  writeCache(payload);
  broadcastStateUpdate(conversationId, state);
}

function broadcastStateUpdate(conversationId: string, data: CachedChatState): void {
  if (typeof window === "undefined") return;
  if (getStorage() !== localStorage) return;
  try {
    const channel = new BroadcastChannel(BC_CHANNEL_NAME);
    channel.postMessage({ type: "chat-state-update", conversationId, data });
    channel.close();
  } catch {
    // BroadcastChannel not available (e.g. old browser)
  }
}

export type ChatStateChangeCallback = (conversationId: string, data: CachedChatState) => void;

/**
 * Subscribe to cache changes from other tabs (BroadcastChannel). Returns unsubscribe.
 * Only active in browser (localStorage); no-op in Electron.
 */
export function subscribeToChatStateChanges(callback: ChatStateChangeCallback): () => void {
  if (typeof window === "undefined") return () => {};
  if (getStorage() !== localStorage) return () => {};
  try {
    const channel = new BroadcastChannel(BC_CHANNEL_NAME);
    const handler = (e: MessageEvent) => {
      const msg = e.data;
      if (msg?.type !== "chat-state-update" || typeof msg.conversationId !== "string" || !msg.data)
        return;
      const { conversationId, data } = msg;
      if (!Array.isArray(data?.messages)) return;
      callback(conversationId, {
        messages: data.messages,
        loading: Boolean(data.loading),
        timestamp: Number(data.timestamp) || Date.now(),
        ...(typeof data.draft === "string" && { draft: data.draft }),
        ...(data.runWaiting !== undefined && { runWaiting: data.runWaiting }),
      });
    };
    channel.addEventListener("message", handler);
    return () => {
      channel.removeEventListener("message", handler);
      channel.close();
    };
  } catch {
    return () => {};
  }
}

/** Optional: get last active conversation id (shared across tabs when using localStorage). */
export function getLastActiveConversationId(): string | null {
  const { lastActiveConversationId } = readCache();
  return lastActiveConversationId;
}

/** Optional: set last active conversation id. */
export function setLastActiveConversationId(conversationId: string | null): void {
  const payload = readCache();
  payload.lastActiveConversationId = conversationId;
  writeCache(payload);
}

/**
 * Cross-tab guard: returns true if we should skip applying a "loading false" broadcast from another tab.
 * Skip only when the broadcast has fewer messages (stale). When counts are equal, it is the stream-done
 * completion update—do not skip so the other tab shows the final assistant response.
 */
export function shouldSkipLoadingFalseFromOtherTab(
  state: { loading: boolean; messageCount: number },
  dataLoading: boolean,
  msgCount: number
): boolean {
  return state.loading && !dataLoading && msgCount < state.messageCount;
}
