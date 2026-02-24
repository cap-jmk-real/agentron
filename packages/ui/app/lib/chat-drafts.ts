"use client";

/**
 * Per-conversation chat input drafts (message-based).
 * Re-exports from chat-state-cache so draft is stored with conversation state
 * and synced across chat-section, FAB modal, and other tabs via BroadcastChannel.
 */

import { getDraft as getDraftFromCache, setDraft as setDraftInCache } from "./chat-state-cache";

export function getDraft(conversationId: string): string {
  return getDraftFromCache(conversationId);
}

export function setDraft(conversationId: string, text: string): void {
  setDraftInCache(conversationId, text);
}
