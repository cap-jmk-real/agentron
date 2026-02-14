"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MessageCircle, X } from "lucide-react";

type PendingRequest = {
  runId: string;
  question: string;
  reason?: string;
  targetName: string;
  targetType: string;
};

export default function ActionRequiredBanner() {
  const [data, setData] = useState<{ count: number; requests: PendingRequest[] }>({ count: 0, requests: [] });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const fetchPendingHelp = () => {
      fetch("/api/runs/pending-help")
        .then((r) => r.json())
        .then((d) => {
          const count = typeof d.count === "number" ? d.count : 0;
          const requests = Array.isArray(d.requests) ? (d.requests as PendingRequest[]) : [];
          setData({ count, requests });
        })
        .catch(() => setData({ count: 0, requests: [] }));
    };
    fetchPendingHelp();
    const interval = setInterval(fetchPendingHelp, 10_000);
    return () => clearInterval(interval);
  }, []);

  if (data.count === 0 || dismissed) return null;

  return (
    <div className="action-required-banner" role="alert">
      <div className="action-required-banner-inner">
        <MessageCircle size={18} className="action-required-banner-icon" aria-hidden />
        <div className="action-required-banner-text">
          <strong>Action required</strong>
          <span>
            {data.count === 1
              ? "An agent is waiting for your input."
              : `${data.count} runs are waiting for your input.`}
          </span>
        </div>
        <Link href="/chat" className="action-required-banner-cta">
          Open Chat to respond
        </Link>
        {data.requests.length > 0 && (
          <span className="action-required-banner-links">
            {data.requests.slice(0, 3).map((r) => (
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
