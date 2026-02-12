"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Copy, CheckCircle, XCircle, Clock, Loader2, MessageCircle, GitBranch, Square, ThumbsUp, ThumbsDown } from "lucide-react";
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

/** Copy text to clipboard; works in insecure contexts (HTTP) via execCommand fallback. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to fallback
  }
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

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

function TrailStepCard({ step }: { step: ExecutionTraceStep; index: number }) {
  const [expanded, setExpanded] = useState(true);
  const hasInput = step.input !== undefined && step.input !== null;
  const hasOutput = step.output !== undefined && step.output !== null;
  const hasError = !!step.error;

  return (
    <div className="run-trail-step">
      <button type="button" className="run-trail-step-header" onClick={() => setExpanded(!expanded)}>
        <span className="run-trail-step-num">#{step.order + 1}</span>
        {step.round !== undefined && (
          <span className="run-trail-step-round">Round {step.round + 1}</span>
        )}
        <span className="run-trail-step-name">{step.agentName}</span>
        <span className="run-trail-step-node">({step.nodeId})</span>
        {hasError && <span className="run-trail-step-error-badge">— Error</span>}
      </button>
      {expanded && (
        <div className="run-trail-step-body">
          {hasInput && (
            <div>
              <div className="run-trail-step-field-label">Input</div>
              <pre className="run-trail-step-pre">{formatValue(step.input)}</pre>
            </div>
          )}
          {hasOutput && (
            <div>
              <div className="run-trail-step-field-label">Output</div>
              <pre className="run-trail-step-pre">{formatValue(step.output)}</pre>
            </div>
          )}
          {hasError && (
            <div>
              <div className="run-trail-step-field-label error">Error</div>
              <pre className="run-trail-step-pre error">{step.error}</pre>
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
  if (status === "cancelled") {
    return (
      <span className="run-status run-status-cancelled">
        <Square size={14} /> cancelled
      </span>
    );
  }
  if (status === "waiting_for_user") {
    return (
      <span className="run-status" style={{ background: "var(--resource-amber)", color: "var(--bg)" }}>
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

export default function RunDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [rating, setRating] = useState<"good" | "bad" | null>(null);
  const [notes, setNotes] = useState("");
  const [submittingRating, setSubmittingRating] = useState(false);
  const [existingFeedback, setExistingFeedback] = useState<{ label: string; notes?: string } | null>(null);

  const load = useCallback(async (silent?: boolean) => {
    if (!id) return;
    if (!silent) setLoading(true);
    if (!silent) setError(null);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!res.ok) {
        if (!silent) {
          if (res.status === 404) setError("Run not found.");
          else setError("Failed to load run.");
          setRun(null);
        }
        return;
      }
      const data = await res.json();
      setRun(data);
    } catch {
      if (!silent) {
        setError("Failed to load run.");
        setRun(null);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll for updates while the run is in progress so the user sees new trail steps and output as they happen
  useEffect(() => {
    if (run?.status !== "running") return;
    const interval = setInterval(() => void load(true), 1500);
    return () => clearInterval(interval);
  }, [run?.status, load]);

  useEffect(() => {
    if (!run?.id) return;
    fetch(`/api/feedback?executionId=${encodeURIComponent(run.id)}`)
      .then((r) => r.json())
      .then((list) => {
        const first = Array.isArray(list) && list.length > 0 ? list[0] : null;
        if (first && first.label) {
          setExistingFeedback({ label: first.label, notes: first.notes });
          setRating(first.label as "good" | "bad");
          setNotes(first.notes ?? "");
        }
      })
      .catch(() => {});
  }, [run?.id]);

  const handleRateRun = useCallback(async (label: "good" | "bad") => {
    if (!run) return;
    setSubmittingRating(true);
    try {
      const input = (run.output && typeof run.output === "object" && (run.output as { trail?: ExecutionTraceStep[] }).trail?.[0]?.input) ?? run.targetId;
      const output = (run.output && typeof run.output === "object" && (run.output as { output?: unknown }).output) ?? "";
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: run.targetType,
          targetId: run.targetId,
          executionId: run.id,
          input: typeof input === "object" ? JSON.stringify(input) : input,
          output: typeof output === "object" ? JSON.stringify(output) : output,
          label,
          notes: notes.trim() || undefined,
        }),
      });
      setRating(label);
      setExistingFeedback({ label, notes: notes.trim() || undefined });
    } finally {
      setSubmittingRating(false);
    }
  }, [run, notes]);

  const handleCopyForChat = useCallback(() => {
    if (!run) return;
    const text = buildCopyForChatBlock(run);
    void copyToClipboard(text).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    });
  }, [run]);

  const handleStopRun = useCallback(async () => {
    if (!id || !run || run.status !== "running") return;
    setStopping(true);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled", finishedAt: Date.now() }),
      });
      if (res.ok) {
        const data = await res.json();
        setRun(data);
      }
    } finally {
      setStopping(false);
    }
  }, [id, run]);

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
          <div className="run-detail-value" style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <StatusBadge status={run.status} />
            {run.status === "running" && (
              <button
                type="button"
                className="button button-secondary"
                onClick={handleStopRun}
                disabled={stopping}
                style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
              >
                {stopping ? <Loader2 size={14} className="spin" /> : <Square size={14} />}
                {stopping ? "Stopping…" : "Stop run"}
              </button>
            )}
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
          <div className="run-detail-label" style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
            <ThumbsUp size={16} style={{ opacity: 0.8 }} /> Rate this run
          </div>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0.25rem 0 0.5rem 0" }}>
            Your rating is used for improvement (generate_training_data from_feedback). Good = learn from this output; Bad = avoid or correct.
          </p>
          {existingFeedback ? (
            <p style={{ fontSize: "0.9rem", margin: 0 }}>
              You rated this run: <strong>{existingFeedback.label}</strong>
              {existingFeedback.notes && ` — ${existingFeedback.notes}`}
            </p>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                <button
                  type="button"
                  className="button button-success"
                  disabled={submittingRating}
                  onClick={() => handleRateRun("good")}
                  style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
                >
                  <ThumbsUp size={14} /> Good
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={submittingRating}
                  onClick={() => handleRateRun("bad")}
                  style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
                >
                  <ThumbsDown size={14} /> Bad
                </button>
              </div>
              <textarea
                placeholder="Optional notes (e.g. what to improve)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                style={{ width: "100%", maxWidth: "24rem", resize: "vertical", padding: "0.5rem", fontSize: "0.9rem" }}
              />
            </>
          )}
        </div>
      </div>

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
