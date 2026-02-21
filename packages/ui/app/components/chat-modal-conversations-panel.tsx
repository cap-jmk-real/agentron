"use client";

import {
  Minus,
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

export type ChatModalConversationsPanelProps = {
  embedded: boolean;
  showConversationList: boolean;
  setShowConversationList: (v: boolean) => void;
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

export function ChatModalConversationsPanel({
  embedded,
  showConversationList,
  setShowConversationList,
  conversationList,
  conversationId,
  setConversationId,
  loading,
  messages,
  pendingInputIds,
  deleteConversation,
  startNewChat,
  onOpenSettings,
}: ChatModalConversationsPanelProps) {
  return (
    <>
      <div className="chat-conversations-header">
        <span>Conversations</span>
        <button
          type="button"
          className="chat-header-btn"
          onClick={() => setShowConversationList(false)}
          title="Close"
        >
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
                  <span
                    className={`chat-conversation-status chat-conversation-status-${status}`}
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
                <span className="chat-conversation-item-title">
                  {c.title && c.title.trim() ? c.title.trim() : "New chat"}
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
          href={
            conversationId
              ? `/chat/traces?conversationId=${encodeURIComponent(conversationId)}`
              : "/chat/traces"
          }
          target="_blank"
          rel="noopener noreferrer"
          className="chat-sidebar-action-link"
        >
          <GitBranch size={14} />
          Stack traces
        </a>
        {embedded && onOpenSettings && (
          <button
            type="button"
            className="chat-sidebar-action-btn"
            onClick={onOpenSettings}
            title="Assistant settings"
          >
            <Settings2 size={14} />
            Settings
          </button>
        )}
      </div>
    </>
  );
}
