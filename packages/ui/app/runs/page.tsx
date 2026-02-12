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
  return (
    <span className="run-status run-status-queued">
      <Clock size={14} /> {status}
    </span>
  );
}

export default function RunsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/runs", { cache: "no-store" });
      const data = await response.json();
      setRuns(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, []);

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
          Inspect agent, workflow, and tool runs. Open a run to see output or errors and copy a paste-ready block for the chat to help debug.
        </p>
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
                <ChevronRight size={18} className="run-chevron" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
