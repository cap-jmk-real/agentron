"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Loader2, RefreshCw, MessageSquare, GitBranch } from "lucide-react";

type WorkflowQueueJob = {
  id: string;
  type: string;
  payload: string;
  status: string;
  runId: string | null;
  enqueuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  createdAt: number;
};

type QueuesData = {
  workflowQueue: {
    status: { queued: number; running: number; concurrency: number };
    jobs: WorkflowQueueJob[];
  };
  conversationLocks: Array<{ conversationId: string; startedAt: number; createdAt: number }>;
};

function JobStatusBadge({ status }: { status: string }) {
  if (status === "running") {
    return (
      <span className="run-status run-status-running" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
        <Loader2 size={12} className="spin" /> running
      </span>
    );
  }
  if (status === "queued") {
    return <span className="run-status run-status-queued">queued</span>;
  }
  if (status === "completed") {
    return <span className="run-status run-status-success">completed</span>;
  }
  if (status === "failed") {
    return <span className="run-status run-status-failed">failed</span>;
  }
  return <span className="run-status">{status}</span>;
}

export default function QueuesPage() {
  const [data, setData] = useState<QueuesData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/queues", { cache: "no-store" });
      const json = await res.json();
      setData(json);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const formatTs = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay ? d.toLocaleTimeString() : d.toLocaleString();
  };

  if (loading && !data) {
    return (
      <div className="page-content">
        <div className="loading-placeholder">Loading queues…</div>
      </div>
    );
  }

  const wq = data?.workflowQueue ?? { status: { queued: 0, running: 0, concurrency: 2 }, jobs: [] };
  const locks = data?.conversationLocks ?? [];

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">Queues</h1>
        <p className="page-description">
          Track workflow run queue and active chat turns. All jobs are stored in the database; nothing is kept only in memory.
        </p>
        <button
          type="button"
          className="button button-secondary"
          style={{ marginTop: "0.5rem", display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? "spin" : undefined} />
          Refresh
        </button>
      </div>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <GitBranch size={18} />
          Workflow queue
        </h2>
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "0.75rem" }}>
          Queued: {wq.status.queued} · Running: {wq.status.running} · Concurrency: {wq.status.concurrency}
        </p>
        {wq.jobs.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>No jobs in the workflow queue.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                  <th style={{ padding: "0.5rem 0.75rem" }}>Status</th>
                  <th style={{ padding: "0.5rem 0.75rem" }}>Type</th>
                  <th style={{ padding: "0.5rem 0.75rem" }}>Run / Payload</th>
                  <th style={{ padding: "0.5rem 0.75rem" }}>Enqueued</th>
                  <th style={{ padding: "0.5rem 0.75rem" }}>Finished / Error</th>
                </tr>
              </thead>
              <tbody>
                {wq.jobs.map((job) => (
                  <tr key={job.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "0.5rem 0.75rem" }}>
                      <JobStatusBadge status={job.status} />
                    </td>
                    <td style={{ padding: "0.5rem 0.75rem" }}>{job.type}</td>
                    <td style={{ padding: "0.5rem 0.75rem" }}>
                      {job.runId ? (
                        <Link href={`/runs/${job.runId}`} style={{ color: "var(--link)" }}>
                          {job.runId.slice(0, 8)}…
                        </Link>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>{job.payload.slice(0, 40)}…</span>
                      )}
                    </td>
                    <td style={{ padding: "0.5rem 0.75rem", color: "var(--text-muted)" }}>{formatTs(job.enqueuedAt)}</td>
                    <td style={{ padding: "0.5rem 0.75rem", color: "var(--text-muted)", maxWidth: 200 }}>
                      {job.finishedAt != null ? formatTs(job.finishedAt) : ""}
                      {job.error ? (
                        <span className="run-status run-status-failed" style={{ display: "block", marginTop: "0.25rem", fontSize: "0.8rem" }}>
                          {job.error.slice(0, 80)}{job.error.length > 80 ? "…" : ""}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <MessageSquare size={18} />
          Active chat turns (conversation locks)
        </h2>
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "0.75rem" }}>
          One turn at a time per conversation; these rows show which conversations are currently processing.
        </p>
        {locks.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>No active chat turns.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {locks.map((lock) => (
              <li
                key={lock.conversationId}
                style={{
                  padding: "0.5rem 0.75rem",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  marginBottom: "0.5rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                }}
              >
                <Loader2 size={14} className="spin" />
                <Link href={`/chat?conversation=${encodeURIComponent(lock.conversationId)}`} style={{ color: "var(--link)" }}>
                  {lock.conversationId.slice(0, 8)}…
                </Link>
                <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>started {formatTs(lock.startedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
