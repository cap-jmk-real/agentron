"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Copy, CheckCircle, XCircle, Clock, Loader2, MessageCircle, GitBranch } from "lucide-react";
import { openChatWithContext } from "../../components/chat-wrapper";

type ExecutionTraceStep = {
  nodeId: string;
  agentId: string;
  agentName: string;
  order: number;
  round?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
};

type Run = {
  id: string;
  targetType: string;
  targetId: string;
  targetName?: string;
  status: string;
  startedAt: number;
  finishedAt: number | null;
  output?: {
    success?: boolean;
    error?: string;
    errorDetails?: {
      message?: string;
      stack?: string;
      toolId?: string;
      agentId?: string;
      workflowId?: string;
      step?: string;
      [k: string]: unknown;
    };
    output?: unknown;
    trail?: ExecutionTraceStep[];
    [k: string]: unknown;
  } | null;
};

/** Build a paste-ready block for the user to copy into chat for debugging. */
function buildCopyForChatBlock(run: Run): string {
  const lines: string[] = [
    "[AgentOS Run]",
    `Run ID: ${run.id}`,
    `Target: ${run.targetType} — ${run.targetId}`,
    `Status: ${run.status}`,
  ];
  if (run.startedAt) {
    lines.push(`Started: ${new Date(run.startedAt).toISOString()}`);
  }
  if (run.finishedAt) {
    lines.push(`Finished: ${new Date(run.finishedAt).toISOString()}`);
  }
  const out = run.output;
  if (out && typeof out === "object") {
    if (out.success === false && (out.error || out.errorDetails?.message)) {
      lines.push("");
      lines.push("Error: " + (out.error ?? (out.errorDetails as { message?: string })?.message ?? "Unknown"));
      if ((out.errorDetails as { stack?: string })?.stack) {
        lines.push("");
        lines.push("Stack:");
        lines.push((out.errorDetails as { stack: string }).stack);
      }
      const details = out.errorDetails as Record<string, unknown> | undefined;
      if (details && typeof details === "object" && !Array.isArray(details)) {
        const { message, stack, ...rest } = details;
        if (rest != null && typeof rest === "object" && !Array.isArray(rest) && Object.keys(rest).length > 0) {
          lines.push("");
          lines.push("Context: " + JSON.stringify(rest));
        }
      }
    } else if (out.output !== undefined) {
      lines.push("");
      lines.push("Output: " + (typeof out.output === "string" ? out.output : JSON.stringify(out.output, null, 2)));
    }
    const trailSteps = (out as { trail?: ExecutionTraceStep[] }).trail;
    if (Array.isArray(trailSteps) && trailSteps.length > 0) {
      lines.push("");
      lines.push("Execution trail:");
      for (const s of trailSteps.sort((a, b) => a.order - b.order)) {
        lines.push(`  #${s.order + 1} ${s.agentName} (${s.nodeId})`);
        if (s.input !== undefined) lines.push("    Input: " + JSON.stringify(s.input));
        if (s.output !== undefined) lines.push("    Output: " + (typeof s.output === "string" ? s.output : JSON.stringify(s.output)));
        if (s.error) lines.push("    Error: " + s.error);
      }
    }
  }
  lines.push("");
  lines.push("---");
  lines.push("Paste this into the Chat assistant to get help debugging.");
  return lines.join("\n");
}

function formatValue(v: unknown): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function TrailStepCard({ step, index }: { step: ExecutionTraceStep; index: number }) {
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
        <span style={{ fontWeight: 600, color: "var(--text-muted)", minWidth: 20 }}>#{step.order + 1}</span>
        {step.round !== undefined && (
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", background: "var(--surface)", padding: "0.1rem 0.35rem", borderRadius: 4 }}>Round {step.round + 1}</span>
        )}
        <span style={{ fontWeight: 600 }}>{step.agentName}</span>
        <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>({step.nodeId})</span>
        {hasError && <span style={{ color: "var(--resource-red)", fontSize: "0.8rem" }}>— Error</span>}
      </button>
      {expanded && (
        <div style={{ padding: "0 0.75rem 0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {hasInput && (
            <div>
              <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.2rem" }}>Input</div>
              <pre style={{ margin: 0, padding: "0.5rem", background: "var(--surface)", borderRadius: 6, fontSize: "0.8rem", overflow: "auto", maxHeight: 200 }}>{formatValue(step.input)}</pre>
            </div>
          )}
          {hasOutput && (
            <div>
              <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.2rem" }}>Output</div>
              <pre style={{ margin: 0, padding: "0.5rem", background: "var(--surface)", borderRadius: 6, fontSize: "0.8rem", overflow: "auto", maxHeight: 200 }}>{formatValue(step.output)}</pre>
            </div>
          )}
          {hasError && (
            <div>
              <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--resource-red)", marginBottom: "0.2rem" }}>Error</div>
              <pre style={{ margin: 0, padding: "0.5rem", background: "var(--surface)", borderRadius: 6, fontSize: "0.8rem", overflow: "auto", color: "var(--resource-red)" }}>{step.error}</pre>
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
  return (
    <span className="run-status run-status-queued">
      <Clock size={14} /> {status}
    </span>
  );
}

export default function RunDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 404) setError("Run not found.");
        else setError("Failed to load run.");
        setRun(null);
        return;
      }
      const data = await res.json();
      setRun(data);
    } catch {
      setError("Failed to load run.");
      setRun(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCopyForChat = useCallback(() => {
    if (!run) return;
    const text = buildCopyForChatBlock(run);
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [run]);

  if (loading) {
    return (
      <div className="page-content">
        <div className="loading-placeholder">Loading run…</div>
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="page-content">
        <p style={{ color: "var(--resource-red)" }}>{error ?? "Run not found."}</p>
        <Link href="/runs" className="button button-secondary">
          <ArrowLeft size={14} /> Back to Runs
        </Link>
      </div>
    );
  }

  const out = run.output;
  const hasError = out && typeof out === "object" && (out.success === false || out.error || (out.errorDetails as { message?: string })?.message);
  const debugBlock = buildCopyForChatBlock(run);
  const trail = (out && typeof out === "object" && Array.isArray((out as { trail?: ExecutionTraceStep[] }).trail))
    ? (out as { trail: ExecutionTraceStep[] }).trail
    : [];

  return (
    <div className="page-content">
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
        <Link href="/runs" className="icon-button" style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
          <ArrowLeft size={16} /> Back
        </Link>
      </div>

      <div className="run-detail-card">
        <div className="run-detail-section">
          <div className="run-detail-label">Status</div>
          <div className="run-detail-value">
            <StatusBadge status={run.status} />
          </div>
        </div>
        <div className="run-detail-section">
          <div className="run-detail-label">Run ID</div>
          <div className="run-detail-value" style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.85rem" }}>{run.id}</div>
        </div>
        <div className="run-detail-section">
          <div className="run-detail-label">{run.status === "running" ? "Executing" : "Target"}</div>
          <div className="run-detail-value">
            {run.status === "running" && run.targetName
              ? run.targetName
              : run.targetName
                ? `${run.targetType}: ${run.targetName}`
                : `${run.targetType} — ${run.targetId}`}
          </div>
        </div>
        <div className="run-detail-section">
          <div className="run-detail-label">Started</div>
          <div className="run-detail-value">{new Date(run.startedAt).toLocaleString()}</div>
        </div>
        {run.finishedAt != null && (
          <div className="run-detail-section">
            <div className="run-detail-label">Finished</div>
            <div className="run-detail-value">{new Date(run.finishedAt).toLocaleString()}</div>
          </div>
        )}
      </div>

      {out != null && typeof out === "object" && (
        <div className="run-detail-card">
          <div className="run-detail-section">
            <div className="run-detail-label">{hasError ? "Error" : "Output"}</div>
            {hasError ? (
              <div className="run-detail-value" style={{ color: "var(--resource-red)" }}>
                {(out as { error?: string }).error ?? (out.errorDetails as { message?: string })?.message ?? "Unknown error"}
              </div>
            ) : (
              <div className="run-detail-value">
                {(out as { output?: unknown }).output !== undefined
                  ? typeof (out as { output: unknown }).output === "string"
                    ? (out as { output: string }).output
                    : JSON.stringify((out as { output: unknown }).output, null, 2)
                  : JSON.stringify(out, null, 2)}
              </div>
            )}
            {(out.errorDetails as { stack?: string })?.stack && (
              <pre className="run-debug-block" style={{ marginTop: "0.75rem" }}>
                {(out.errorDetails as { stack: string }).stack}
              </pre>
            )}
            {hasError && run.targetType === "workflow" && (
              <div
                className="run-detail-value"
                style={{
                  marginTop: "1rem",
                  padding: "0.75rem 1rem",
                  background: "var(--surface-muted)",
                  borderRadius: 8,
                  borderLeft: "3px solid var(--resource-amber)",
                  fontSize: "0.9rem",
                }}
              >
                <strong style={{ display: "block", marginBottom: "0.35rem" }}>Workflow runs use each agent’s LLM</strong>
                <p style={{ margin: 0, color: "var(--text-muted)" }}>
                  The LLM used for this run comes from the <strong>agents in the workflow</strong>, not from the Chat assistant setting.
                  Rate-limit or quota errors usually mean those agents are configured with a provider that has limits (e.g. OpenRouter free tier).
                </p>
                <p style={{ margin: "0.5rem 0 0 0", color: "var(--text-muted)" }}>
                  To use OpenAI: open the{" "}
                  <Link href={`/workflows/${run.targetId}`} style={{ color: "var(--link)", fontWeight: 500 }}>
                    workflow
                  </Link>
                  , then edit each agent and set <strong>LLM</strong> to your OpenAI provider (Settings → LLM).
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {trail.length > 0 && (
        <div className="run-detail-card">
          <div className="run-detail-section" style={{ marginBottom: "1rem" }}>
            <div className="run-detail-label" style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <GitBranch size={16} /> Execution trail
            </div>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0.25rem 0 0 0" }}>
              Per-agent input and output for each step. Output from one agent flows as input to the next via workflow edges.
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {trail
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((step, i) => (
                <TrailStepCard key={`${step.nodeId}-${step.order}`} step={step} index={i} />
              ))}
          </div>
        </div>
      )}

      <div className="run-detail-card">
        <div className="run-detail-section">
          <div className="run-detail-label">Copy for chat</div>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0.25rem 0 0 0" }}>
            Paste this block into the Chat assistant to get help debugging.
          </p>
          <pre className="run-debug-block">{debugBlock}</pre>
          <div className="run-debug-actions" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" }}>
            <button
              type="button"
              className="button button-success"
              onClick={() => openChatWithContext(debugBlock)}
              style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
            >
              <MessageCircle size={14} /> Open in chat
            </button>
            <button
              type="button"
              className="button"
              onClick={handleCopyForChat}
              style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
            >
              {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy for chat"}
            </button>
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
              Open in chat sends the output to the assistant so you can ask without pasting.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
