"use client";

import { useState, useEffect, useCallback } from "react";
import { Bell } from "lucide-react";
import NotificationsModal, {
  type NotificationItem,
  type NotificationFilter,
} from "./notifications-modal";
import {
  NOTIFICATIONS_UPDATED_EVENT,
  dispatchNotificationsUpdated,
} from "../lib/notifications-events";

export default function NotificationsButton() {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNotifications = useCallback(async () => {
    setError(null);
    const doFetch = async (): Promise<{ items: NotificationItem[]; totalActiveCount: number }> => {
      const typesParam = filter === "all" ? "" : filter === "run" ? "run" : "chat";
      const params = new URLSearchParams();
      params.set("status", "active");
      if (typesParam) params.set("types", typesParam);
      params.set("limit", "50");
      const res = await fetch(`/api/notifications?${params.toString()}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        items?: NotificationItem[];
        totalActiveCount?: number;
      };
      if (!res.ok) throw new Error("Failed to load notifications");
      const nextItems = Array.isArray(data.items) ? data.items : [];
      const totalActiveCount =
        typeof data.totalActiveCount === "number" ? data.totalActiveCount : 0;
      return { items: nextItems, totalActiveCount };
    };
    try {
      let result = await doFetch();
      // Retry once when server reported active count but returned no items (race with other requests).
      if (result.items.length === 0 && result.totalActiveCount > 0) {
        result = await doFetch();
      }
      setItems(result.items);
      setCount(result.totalActiveCount);
      setError(null);
    } catch (e) {
      setError("Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  const fetchBadgeOnly = useCallback(async () => {
    const res = await fetch("/api/notifications?status=active&limit=0", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { totalActiveCount: number };
    setCount(typeof data.totalActiveCount === "number" ? data.totalActiveCount : 0);
  }, []);

  useEffect(() => {
    const run = () => {
      void fetchBadgeOnly();
    };
    queueMicrotask(run);
    const t = setInterval(run, 30_000);
    return () => clearInterval(t);
  }, [fetchBadgeOnly]);

  useEffect(() => {
    const handler = () => {
      void fetchBadgeOnly();
      if (open) void fetchNotifications();
    };
    window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, handler);
    return () => window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, handler);
  }, [open, fetchBadgeOnly, fetchNotifications]);

  useEffect(() => {
    if (open) {
      queueMicrotask(() => {
        void fetchNotifications();
      });
    }
  }, [open, filter, fetchNotifications]);

  const handleClearOne = useCallback(async (id: string) => {
    const res = await fetch("/api/notifications/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      setItems((prev) => prev.filter((n) => n.id !== id));
      setCount((c) => Math.max(0, c - 1));
      dispatchNotificationsUpdated();
    }
  }, []);

  const handleClearAll = useCallback(async () => {
    const body = filter === "all" ? {} : { types: [filter] };
    const res = await fetch("/api/notifications/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = (await res.json()) as { cleared: number };
      setCount((c) => Math.max(0, c - (data.cleared ?? 0)));
      setItems([]);
      dispatchNotificationsUpdated();
    }
  }, [filter]);

  return (
    <>
      <button
        type="button"
        className="icon-button notifications-trigger"
        onClick={() => {
          setOpen(true);
          setLoading(true);
          setError(null);
        }}
        title="Notifications"
        aria-label={count > 0 ? `${count} unread notifications` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Bell size={14} />
        {count > 0 && (
          <span className="notifications-badge" aria-hidden="true">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
      <NotificationsModal
        open={open}
        onClose={() => {
          setOpen(false);
          setLoading(false);
        }}
        items={items}
        totalActiveCount={count}
        activeFilter={filter}
        onFilterChange={setFilter}
        onClearOne={handleClearOne}
        onClearAll={handleClearAll}
        loading={loading}
        error={error}
      />
    </>
  );
}
