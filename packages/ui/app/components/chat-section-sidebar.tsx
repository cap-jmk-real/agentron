"use client";

import {
  PanelLeftClose,
  MessageSquarePlus,
  Check,
  Loader,
  CircleDot,
  Trash2,
  GitBranch,
  Settings2,
} from "lucide-react";
import { hasAskUserWaitingForInput } from "./chat-message-content";
import type { Message } from "./chat-types";

export type ConversationItem = {
  id: string;
  title: string | null;
  rating: number | null;
  note: string | null;
  createdAt: number;
};

export type ChatSectionSidebarProps = {
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  conversationList: ConversationItem[];
  conversationId: string | null;
  setConversationId: (id: string) => void;
  loading: boolean;
  messages: Message[];
  pendingInputIds: Set<string>;
  deleteConversation: (id: string, e: React.MouseEvent) => void;
  startNewChat: () => void;
  onOpenSettings?: () => void;
};

export function ChatSectionSidebar({
  sidebarOpen,
  setSidebarOpen,
  conversationList,
  conversationId,
  setConversationId,
  loading,
  messages,
  pendingInputIds,
  deleteConversation,
  startNewChat,
  onOpenSettings,
}: ChatSectionSidebarProps) {
  if (!sidebarOpen) return null;
  return (
    <aside className="chat-section-sidebar">
      <div className="chat-section-sidebar-header">
        <button
          type="button"
          className="chat-section-sidebar-close"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close sidebar"
        >
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
                    const lastAssistant = [...messages]
                      .reverse()
                      .find((m) => m.role === "assistant");
                    return lastAssistant && hasAskUserWaitingForInput(lastAssistant.toolResults)
                      ? "waiting"
                      : "finished";
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
                  <span
                    className={`chat-section-conv-status chat-section-conv-status-${status}`}
                    title={
                      status === "running"
                        ? "Running"
                        : status === "waiting"
                          ? "Waiting for input"
                          : "Finished"
                    }
                  >
                    {status === "finished" && <Check size={12} />}
                    {status === "running" && (
                      <Loader size={12} className="chat-conv-status-loader" />
                    )}
                    {status === "waiting" && <CircleDot size={12} />}
                  </span>
                )}
                <span className="chat-section-conv-title">
                  {c.title && c.title.trim() ? c.title.trim() : "New chat"}
                </span>
              </button>
              <button
                type="button"
                className="chat-section-conv-delete"
                onClick={(e) => deleteConversation(c.id, e)}
                title="Delete"
                aria-label="Delete"
              >
                <Trash2 size={14} />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="chat-section-sidebar-footer">
        <a
          href={
            conversationId
              ? `/chat/traces?conversationId=${encodeURIComponent(conversationId)}`
              : "/chat/traces"
          }
          target="_blank"
          rel="noopener noreferrer"
          className="chat-section-sidebar-link"
        >
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
  );
}
