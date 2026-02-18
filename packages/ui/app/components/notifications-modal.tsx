"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Bell, Play, MessageCircle, X, CheckCheck } from "lucide-react";

export type NotificationItem = {
  id: string;
  type: "run" | "chat" | "system";
  sourceId: string;
  title: string;
  message: string;
  severity: "info" | "success" | "warning" | "error";
  status: string;
  createdAt: number;
  updatedAt: number;
  targetName?: string;
  conversationTitle?: string;
  metadata?: Record<string, unknown>;
};

export type NotificationFilter = "all" | "run" | "chat";

type Props = {
  open: boolean;
  onClose: () => void;
  items: NotificationItem[];
  totalActiveCount: number;
  activeFilter: NotificationFilter;
  onFilterChange: (f: NotificationFilter) => void;
  onClearOne: (id: string) => void;
  onClearAll: () => void;
  onItemClick?: (item: NotificationItem) => void;
  loading?: boolean;
  error?: string | null;
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return "Just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function NotificationsModal({
  open,
  onClose,
  items,
  totalActiveCount,
  activeFilter,
  onFilterChange,
  onClearOne,
  onClearAll,
  loading = false,
  error = null,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [open, onClose]);

  if (!open) return null;

  const filters: { id: NotificationFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "run", label: "Runs" },
    { id: "chat", label: "Chats" },
  ];

  return (
    <div
      className="notifications-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notifications-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="notifications-modal">
        <div className="notifications-modal-header">
          <div className="notifications-modal-title-row">
            <h2 id="notifications-modal-title" className="notifications-modal-title">
              Notifications
            </h2>
            {totalActiveCount > 0 && (
              <button
                type="button"
                className="notifications-clear-all"
                onClick={onClearAll}
                aria-label="Clear all notifications"
              >
                <CheckCheck size={14} />
                Clear all
              </button>
            )}
          </div>
          <p className="notifications-modal-subtitle">From runs and chats</p>
          <div className="notifications-modal-tabs">
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`notifications-tab ${activeFilter === f.id ? "active" : ""}`}
                onClick={() => onFilterChange(f.id)}
                aria-pressed={activeFilter === f.id}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="notifications-modal-body">
          {loading && (
            <div className="notifications-loading" aria-live="polite">
              Loading…
            </div>
          )}
          {error && (
            <div className="notifications-error" role="alert">
              {error}
            </div>
          )}
          {!loading && !error && items.length === 0 && (
            <div className="notifications-empty" aria-live="polite">
              <Bell size={32} strokeWidth={1.2} />
              <p>No notifications</p>
              <p className="notifications-empty-hint">
                {activeFilter === "all" ? "Runs and chats will appear here." : `No ${activeFilter} notifications yet.`}
              </p>
            </div>
          )}
          {!loading && !error && items.length > 0 && (
            <ul className="notifications-list" aria-label="Notifications list">
              {items.map((item) => (
                <li key={item.id} className="notifications-item">
                  <Link
                    href={item.type === "run" ? `/runs/${item.sourceId}` : item.type === "chat" ? `/chat?conversation=${item.sourceId}` : "#"}
                    className="notifications-item-link"
                    onClick={() => onClose()}
                  >
                    <span className="notifications-item-icon">
                      {item.type === "run" ? <Play size={14} /> : item.type === "chat" ? <MessageCircle size={14} /> : <Bell size={14} />}
                    </span>
                    <span className="notifications-item-content">
                      <span className="notifications-item-title">{item.title}</span>
                      {(item.targetName ?? item.conversationTitle ?? item.message) && (
                        <span className="notifications-item-message">
                          {item.type === "run" && item.targetName
                            ? item.targetName
                            : item.type === "chat" && item.conversationTitle
                              ? item.conversationTitle
                              : item.message || ""}
                        </span>
                      )}
                      <span className="notifications-item-time">{formatTime(item.createdAt)}</span>
                    </span>
                    <span className={`notifications-item-severity severity-${item.severity}`}>{item.severity}</span>
                  </Link>
                  <button
                    type="button"
                    className="notifications-item-clear"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onClearOne(item.id);
                    }}
                    aria-label={`Clear notification: ${item.title}`}
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="notifications-modal-footer">
          <button type="button" className="notifications-close-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
