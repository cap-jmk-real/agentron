"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, GitBranch, ExternalLink, CheckCircle, XCircle, Clock, Loader2, Copy, Check } from "lucide-react";

type ExecutionTraceStep = {
  nodeId: string;
  agentId: string;
  agentName: string;
  order: number;
  round?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
  inputIsUserReply?: boolean;
};

type RunListItem = {
  id: string;
  targetType: string;
  targetId: string;
  targetName?: string;
  status: string;
  startedAt: number;
  finishedAt: number | null;
};

type TraceResponse = {
  id: string;
  targetType: string;
  targetId: string;
  targetName?: string;
  status: string;
  startedAt: number;
  finishedAt: number | null;
  trail: ExecutionTraceStep[];
};

function formatValue(v: unknown): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function buildTraceText(trace: TraceResponse): string {
  const lines: string[] = [
    "[Workflow Execution Trace]",
    `Run ID: ${trace.id}`,
    `Target: ${trace.targetType} — ${trace.targetName || trace.targetId}`,
    `Status: ${trace.status}`,
    `Started: ${new Date(trace.startedAt).toISOString()}`,
    trace.finishedAt != null ? `Finished: ${new Date(trace.finishedAt).toISOString()}` : "",
    "",
    "Execution trail:",
  ];
  const sorted = [...(trace.trail || [])].sort((a, b) => a.order - b.order);
  sorted.forEach((step, i) => {
    lines.push(`  #${i + 1} ${step.agentName} (${step.nodeId})${step.round !== undefined ? ` [Round ${step.round + 1}]` : ""}`);
    if (step.input !== undefined) {
      const label = step.inputIsUserReply ? "User reply (agent received):" : "Input:";
      lines.push("    " + label + " " + (typeof step.input === "string" ? step.input : JSON.stringify(step.input)));
    }
    if (step.output !== undefined) lines.push("    Output: " + (typeof step.output === "string" ? step.output : JSON.stringify(step.output)));
    if (step.error) lines.push("    Error: " + step.error);
    lines.push("");
  });
  return lines.join("\n");
}

function TrailStepCard({ step }: { step: ExecutionTraceStep }) {
  const [expanded, setExpanded] = useState(true);
  const hasInput = step.input !== undefined && step.input !== null;
  const hasOutput = step.output !== undefined && step.output !== null;
  const hasError = !!step.error;

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        overflow: "hidden",
        background: "var(--surface-muted)",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%",
          padding: "0.6rem 0.75rem",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          fontSize: "0.9rem",
        }}
      >
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span style={{ fontWeight: 600, color: "var(--text-muted)", minWidth: 24 }}>#{step.order + 1}</span>
        {step.round !== undefined && (
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", background: "var(--surface)", padding: "0.1rem 0.35rem", borderRadius: 4 }}>
            Round {step.round + 1}
          </span>
        )}
        <span style={{ fontWeight: 600 }}>{step.agentName}</span>
        <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>({step.nodeId})</span>
        {hasError && <span style={{ color: "var(--resource-red)", fontSize: "0.8rem" }}>— Error</span>}
      </button>
      {expanded && (
        <div style={{ padding: "0 0.75rem 0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {hasInput && (
            <div>
              <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.2rem" }}>
                {step.inputIsUserReply ? "User reply (agent received this)" : "Input"}
              </div>
              <pre style={{ margin: 0, padding: "0.5rem", background: "var(--surface)", borderRadius: 6, fontSize: "0.8rem", overflow: "auto", maxHeight: 200 }}>
                {formatValue(step.input)}
              </pre>
            </div>
          )}
          {hasOutput && (
            <div>
              <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.2rem" }}>Output</div>
              <pre style={{ margin: 0, padding: "0.5rem", background: "var(--surface)", borderRadius: 6, fontSize: "0.8rem", overflow: "auto", maxHeight: 200 }}>
                {formatValue(step.output)}
              </pre>
            </div>
          )}
          {hasError && (
            <div>
              <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--resource-red)", marginBottom: "0.2rem" }}>Error</div>
              <pre style={{ margin: 0, padding: "0.5rem", background: "var(--surface)", borderRadius: 6, fontSize: "0.8rem", overflow: "auto", color: "var(--resource-red)" }}>
                {step.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "completed" || status === "success") {
    return (
      <span className="run-status run-status-success" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
        <CheckCircle size={12} /> {status}
      </span>
    );
  }
  if (status === "failed" || status === "error") {
    return (
      <span className="run-status run-status-failed" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
        <XCircle size={12} /> {status}
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className="run-status run-status-running" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
        <Loader2 size={12} className="spin" /> {status}
      </span>
    );
  }
  return (
    <span className="run-status run-status-queued" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
      <Clock size={12} /> {status}
    </span>
  );
}

type Props = { workflowId: string };

export default function WorkflowStackTracesView({ workflowId }: Props) {
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trace, setTrace] = useState<TraceResponse | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [loadingTrace, setLoadingTrace] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const res = await fetch("/api/runs", { cache: "no-store" });
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setRuns(list.filter((r: RunListItem) => r.targetType === "workflow" && r.targetId === workflowId));
    } catch {
      setRuns([]);
    } finally {
      setLoadingRuns(false);
    }
  }, [workflowId]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    if (!selectedId) {
      setTrace(null);
      return;
    }
    setLoadingTrace(true);
    setTrace(null);
    fetch(`/api/runs/${encodeURIComponent(selectedId)}/trace`, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("Not found");
        return res.json();
      })
      .then(setTrace)
      .catch(() => setTrace(null))
      .finally(() => setLoadingTrace(false));
  }, [selectedId]);

  const sortedTrail = trace?.trail ? [...trace.trail].sort((a, b) => a.order - b.order) : [];

  const handleCopyTrace = useCallback(() => {
    if (!trace) return;
    const text = buildTraceText(trace);
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [trace]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 320, overflow: "hidden" }}>
      <div style={{ padding: "0.75rem 0", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
        <GitBranch size={18} style={{ color: "var(--text-muted)" }} />
        <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600 }}>Execution traces</h3>
        <button type="button" className="button button-secondary" onClick={loadRuns} style={{ marginLeft: "auto", fontSize: "0.8rem" }}>
          Refresh
        </button>
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div
          style={{
            width: 240,
            flexShrink: 0,
            borderRight: "1px solid var(--border)",
            overflowY: "auto",
            padding: "0.5rem",
          }}
        >
          {loadingRuns && <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Loading…</p>}
          {!loadingRuns && runs.length === 0 && (
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>No runs yet. Execute the workflow to see traces.</p>
          )}
          {!loadingRuns &&
            runs.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => setSelectedId(run.id)}
                style={{
                  width: "100%",
                  padding: "0.5rem 0.6rem",
                  marginBottom: "0.25rem",
                  textAlign: "left",
                  background: selectedId === run.id ? "var(--surface-muted)" : "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: "0.8rem",
                }}
              >
                <StatusBadge status={run.status} />
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                  {new Date(run.startedAt).toLocaleString()}
                </div>
              </button>
            ))}
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "1rem", minWidth: 0 }}>
          {!selectedId && (
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Select a run to view its execution trace.</p>
          )}
          {selectedId && loadingTrace && <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Loading trace…</p>}
          {selectedId && !loadingTrace && trace && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
                <StatusBadge status={trace.status} />
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                  {new Date(trace.startedAt).toLocaleString()}
                  {trace.finishedAt != null && ` – ${new Date(trace.finishedAt).toLocaleString()}`}
                </span>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={handleCopyTrace}
                  style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.8rem", marginLeft: "auto" }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "Copied" : "Copy trace"}
                </button>
                <Link
                  href={`/runs/${trace.id}`}
                  className="button button-secondary"
                  style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.8rem" }}
                >
                  <ExternalLink size={14} /> Full run
                </Link>
              </div>
              {sortedTrail.length === 0 ? (
                <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>No step-by-step trace for this run.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {sortedTrail.map((step) => (
                    <TrailStepCard key={`${step.nodeId}-${step.order}`} step={step} />
                  ))}
                </div>
              )}
            </>
          )}
          {selectedId && !loadingTrace && !trace && (
            <p style={{ color: "var(--resource-red)", fontSize: "0.9rem" }}>Could not load trace.</p>
          )}
        </div>
      </div>
    </div>
  );
}
