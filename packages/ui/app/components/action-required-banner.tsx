"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { NOTIFICATIONS_UPDATED_EVENT } from "../lib/notifications-events";

type NotificationItem = {
  id: string;
  type: string;
  sourceId: string;
  title: string;
  targetName?: string;
};

export default function ActionRequiredBanner() {
  const [runItems, setRunItems] = useState<NotificationItem[]>([]);
  const [chatCount, setChatCount] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        const res = await fetch("/api/notifications?status=active&limit=100");
        if (!res.ok) return;
        const data = (await res.json()) as { items: NotificationItem[]; totalActiveCount: number };
        const items = Array.isArray(data.items) ? data.items : [];
        setRunItems(items.filter((n) => n.type === "run"));
        setChatCount(items.filter((n) => n.type === "chat").length);
      } catch {
        setRunItems([]);
        setChatCount(0);
      }
    };
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 10_000);
    const onUpdated = () => {
      void fetchNotifications();
    };
    window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, onUpdated);
    return () => {
      clearInterval(interval);
      window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, onUpdated);
    };
  }, []);

  const totalCount = runItems.length + chatCount;
  if (totalCount === 0 || dismissed) return null;

  const runLabel = runItems.length === 1 ? "1 run" : `${runItems.length} runs`;
  const chatLabel = chatCount === 1 ? "1 chat" : `${chatCount} chats`;
  const parts = [
    runItems.length > 0 ? `${runLabel} waiting for your input` : null,
    chatCount > 0 ? `${chatLabel} need your decision` : null,
  ].filter(Boolean);

  return (
    <div className="action-required-banner" role="alert">
      <div className="action-required-banner-inner">
        <MessageCircle size={18} className="action-required-banner-icon" aria-hidden />
        <div className="action-required-banner-text">
          <strong>Action required</strong>
          <span>{parts.join("; ")}.</span>
        </div>
        <Link href="/chat" className="action-required-banner-cta">
          Open Chat to respond
        </Link>
        {runItems.length > 0 && (
          <span className="action-required-banner-links">
            {runItems.slice(0, 3).map((r) => (
              <Link
                key={r.id}
                href={`/runs/${r.sourceId}`}
                className="action-required-banner-run-link"
              >
                {r.targetName || "Run"}
              </Link>
            ))}
          </span>
        )}
        <button
          type="button"
          className="action-required-banner-dismiss"
          onClick={() => setDismissed(true)}
          title="Dismiss (reappears when new requests arrive)"
          aria-label="Dismiss banner"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
