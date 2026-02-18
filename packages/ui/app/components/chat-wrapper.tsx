"use client";

import { useState, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import ChatModal from "./chat-modal";

const OPEN_CHAT_EVENT = "agentron-open-chat";
const CHAT_FAB_OPEN_KEY = "agentron-chat-fab-open";

export default function ChatWrapper() {
  const pathname = usePathname();
  const isChatPage = pathname === "/chat";
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (isChatPage) return;
    try {
      if (sessionStorage.getItem(CHAT_FAB_OPEN_KEY) === "1") queueMicrotask(() => setOpen(true));
    } catch {
      /* ignore */
    }
  }, [isChatPage]);

  useEffect(() => {
    if (isChatPage) return;
    try {
      sessionStorage.setItem(CHAT_FAB_OPEN_KEY, open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [isChatPage, open]);
  const [attachedContext, setAttachedContext] = useState<string | null>(null);
  /** When user opens chat with run output, we create a new conversation and pass its id so the first message uses it. */
  const [newConversationId, setNewConversationId] = useState<string | null>(null);

  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent<{ attachedContext?: string }>).detail;
      const context = typeof detail?.attachedContext === "string" ? detail.attachedContext.trim() : "";
      if (context) {
        setAttachedContext(context);
        try {
          const res = await fetch("/api/chat/conversations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "Run output" }),
          });
          const data = await res.json().catch(() => ({}));
          if (data.id) setNewConversationId(data.id);
        } catch {
          // proceed without pre-created conversation
        }
      }
      setOpen(true);
    };
    window.addEventListener(OPEN_CHAT_EVENT, handler);
    return () => window.removeEventListener(OPEN_CHAT_EVENT, handler);
  }, []);

  const clearAttachedContext = useCallback(() => setAttachedContext(null), []);
  const clearNewConversationId = useCallback(() => setNewConversationId(null), []);

  return (
    <>
      {!isChatPage && (
        <button
          className={`chat-fab ${open ? "chat-fab-active" : ""}`}
          onClick={() => setOpen((o) => !o)}
          title={open ? "Minimize" : "Open assistant"}
          aria-label={open ? "Minimize assistant" : "Open assistant"}
        >
          <span className="chat-fab-icon-wrap">
            <img src="/icon-circle.svg" alt="" className="chat-fab-icon-circle" width={28} height={28} />
            <span className={`chat-fab-icon-flip ${open ? "chat-fab-icon-flip-open" : ""}`}>
              <span className="chat-fab-icon-face chat-fab-icon-a">
                <img src="/icon-a-letter.svg" alt="" width={28} height={28} />
              </span>
              <span className="chat-fab-icon-face chat-fab-icon-t">
                <img src="/icon-t-letter-fab.svg" alt="" width={28} height={28} />
              </span>
            </span>
          </span>
        </button>
      )}
      <ChatModal
        open={open}
        onClose={() => setOpen(false)}
        attachedContext={attachedContext}
        clearAttachedContext={clearAttachedContext}
        initialConversationId={newConversationId}
        clearInitialConversationId={clearNewConversationId}
      />
    </>
  );
}

/** Open the chat panel (FAB modal). Call from topbar or anywhere to show the assistant. */
export function openChat() {
  window.dispatchEvent(new CustomEvent(OPEN_CHAT_EVENT));
}

/** Call from any page to open the chat with run output (or other text) attached for the assistant. */
export function openChatWithContext(attachedContext: string) {
  window.dispatchEvent(new CustomEvent(OPEN_CHAT_EVENT, { detail: { attachedContext } }));
}
