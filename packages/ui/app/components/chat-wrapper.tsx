"use client";

import { useState, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import ChatModal from "./chat-modal";
import { Sparkles, ChevronDown } from "lucide-react";

const OPEN_CHAT_EVENT = "agentron-open-chat";

export default function ChatWrapper() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [attachedContext, setAttachedContext] = useState<string | null>(null);
  /** When user opens chat with run output, we create a new conversation and pass its id so the first message uses it. */
  const [newConversationId, setNewConversationId] = useState<string | null>(null);

  const isChatPage = pathname === "/chat";

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
        >
          {open ? <ChevronDown size={18} /> : <Sparkles size={17} />}
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

/** Call from any page to open the chat with run output (or other text) attached for the assistant. */
export function openChatWithContext(attachedContext: string) {
  window.dispatchEvent(new CustomEvent(OPEN_CHAT_EVENT, { detail: { attachedContext } }));
}
