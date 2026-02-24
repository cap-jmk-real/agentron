"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ChevronRight, CheckCircle, XCircle, Clock, Loader2, Square } from "lucide-react";

type Run = {
  id: string;
  targetType: string;
  targetId: string;
  targetName?: string;
  status: string;
  startedAt: number;
  finishedAt: number | null;
  output?: unknown;
};

function StatusBadge({ status }: { status: string }) {
  if (status === "completed" || status === "success") {
    return (
      <span className="run-status run-status-success">
        <CheckCircle size={14} /> {status}
      </span>
    );
  }
  if (status === "failed" || status === "error") {
    return (
      <span className="run-status run-status-failed">
        <XCircle size={14} /> {status}
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className="run-status run-status-running">
        <Loader2 size={14} className="spin" /> {status}
      </span>
    );
  }
  if (status === "cancelled") {
    return (
      <span className="run-status run-status-cancelled">
        <Square size={14} /> cancelled
      </span>
    );
  }
  if (status === "waiting_for_user") {
    return (
      <span className="run-status run-status-waiting">
        <Clock size={14} /> Needs your input
      </span>
    );
  }
  return (
    <span className="run-status run-status-queued">
      <Clock size={14} /> {status}
    </span>
  );
}

export default function RunsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTargetType, setFilterTargetType] = useState<string>("");
  const [stoppingRunId, setStoppingRunId] = useState<string | null>(null);

  const handleStopRun = useCallback(async (runId: string) => {
    setStoppingRunId(runId);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled", finishedAt: Date.now() }),
      });
      if (res.ok) {
        const data = await res.json();
        setRuns((prev) =>
          prev.map((r) =>
            r.id === runId
              ? {
                  ...r,
                  status: data.status ?? "cancelled",
                  finishedAt: data.finishedAt ?? Date.now(),
                }
              : r
          )
        );
      }
    } finally {
      setStoppingRunId(null);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterTargetType && filterTargetType !== "all")
        params.set("targetType", filterTargetType);
      params.set("limit", "50");
      const response = await fetch(`/api/runs?${params.toString()}`, { cache: "no-store" });
      const data = await response.json();
      setRuns(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, [filterTargetType]);

  useEffect(() => {
    void load();
  }, [load]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay ? d.toLocaleTimeString() : d.toLocaleString();
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">Runs</h1>
        <p className="page-description">
          Inspect agent, workflow, and tool runs. Open a run to see output or errors and copy a
          paste-ready block for the chat to help debug.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.5rem" }}>
          <label htmlFor="runs-filter" style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>
            Filter:
          </label>
          <select
            id="runs-filter"
            value={filterTargetType || "all"}
            onChange={(e) => setFilterTargetType(e.target.value === "all" ? "" : e.target.value)}
            style={{
              padding: "0.35rem 0.6rem",
              borderRadius: 6,
              border: "1px solid var(--border)",
            }}
          >
            <option value="all">All</option>
            <option value="workflow">Workflows</option>
            <option value="agent">Agents</option>
          </select>
        </div>
      </div>
      {loading ? (
        <div className="loading-placeholder">Loading runs…</div>
      ) : runs.length === 0 ? (
        <div className="empty-state">
          <p>No runs yet. Execute an agent or workflow to see them here.</p>
        </div>
      ) : (
        <ul className="run-list">
          {runs.map((run) => (
            <li key={run.id} className="run-list-item">
              <Link href={`/runs/${run.id}`} className="run-list-link">
                <StatusBadge status={run.status} />
                <span className="run-target">
                  {run.status === "running" && run.targetName
                    ? `Executing: ${run.targetName}`
                    : run.targetName
                      ? `${run.targetType}: ${run.targetName}`
                      : `${run.targetType}:${run.targetId}`}
                </span>
                <span className="run-time">{formatTime(run.startedAt)}</span>
                {(run.status === "running" || run.status === "waiting_for_user") && (
                  <button
                    type="button"
                    className="button button-secondary"
                    style={{
                      marginLeft: "auto",
                      padding: "0.25rem 0.5rem",
                      fontSize: "0.85rem",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.35rem",
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void handleStopRun(run.id);
                    }}
                    disabled={stoppingRunId === run.id}
                    title={run.status === "waiting_for_user" ? "Cancel run" : "Stop run"}
                  >
                    {stoppingRunId === run.id ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <Square size={14} />
                    )}
                    {stoppingRunId === run.id
                      ? "Stopping…"
                      : run.status === "waiting_for_user"
                        ? "Cancel"
                        : "Stop"}
                  </button>
                )}
                <ChevronRight size={18} className="run-chevron" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
