"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MessageCircle, X } from "lucide-react";

type PendingRequest = {
  runId: string;
  question: string;
  reason?: string;
  suggestions?: string[];
  targetName: string;
  targetType: string;
};

type ChatPending = {
  count: number;
  conversations: { conversationId: string; title: string | null }[];
};

export default function ActionRequiredBanner() {
  const [runs, setRuns] = useState<{ count: number; requests: PendingRequest[] }>({ count: 0, requests: [] });
  const [chat, setChat] = useState<ChatPending>({ count: 0, conversations: [] });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const fetchPending = () => {
      Promise.all([
        fetch("/api/runs/pending-help").then((r) => r.json()),
        fetch("/api/chat/pending-input").then((r) => r.json()),
      ])
        .then(([runsData, chatData]) => {
          setRuns({
            count: typeof runsData.count === "number" ? runsData.count : 0,
            requests: Array.isArray(runsData.requests) ? (runsData.requests as PendingRequest[]) : [],
          });
          setChat({
            count: typeof chatData.count === "number" ? chatData.count : 0,
            conversations: Array.isArray(chatData.conversations) ? chatData.conversations : [],
          });
        })
        .catch(() => {
          setRuns({ count: 0, requests: [] });
          setChat({ count: 0, conversations: [] });
        });
    };
    fetchPending();
    const interval = setInterval(fetchPending, 10_000);
    return () => clearInterval(interval);
  }, []);

  const totalCount = runs.count + chat.count;
  if (totalCount === 0 || dismissed) return null;

  const runLabel = runs.count === 1 ? "1 run" : `${runs.count} runs`;
  const chatLabel = chat.count === 1 ? "1 chat" : `${chat.count} chats`;
  const parts = [
    runs.count > 0 ? `${runLabel} waiting for your input` : null,
    chat.count > 0 ? `${chatLabel} need your decision` : null,
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
        {runs.requests.length > 0 && (
          <span className="action-required-banner-links">
            {runs.requests.slice(0, 3).map((r) => (
              <Link key={r.runId} href={`/runs/${r.runId}`} className="action-required-banner-run-link">
                {r.targetName || r.targetType || "Run"}
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
