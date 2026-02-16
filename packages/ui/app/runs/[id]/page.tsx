"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Copy, CheckCircle, XCircle, Clock, Loader2, MessageCircle, GitBranch, Square, ThumbsUp, ThumbsDown, Terminal, Eye, EyeOff } from "lucide-react";
import { openChatWithContext } from "../../components/chat-wrapper";

/** When the agent calls request_user_help, the workflow throws this message; we treat it as "waiting for input", not a failure. */
const WAITING_FOR_USER_MESSAGE = "WAITING_FOR_USER";

type ExecutionTraceStep = {
  nodeId: string;
  agentId: string;
  agentName: string;
  order: number;
  round?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
  toolCalls?: Array<{ name: string; argsSummary?: string }>;
};

type RunLogEntry = { level: string; message: string; createdAt: number };

type Run = {
  id: string;
  targetType: string;
  targetId: string;
  targetName?: string;
  status: string;
  startedAt: number;
  finishedAt: number | null;
  /** Live streamed container stdout/stderr from run_logs (when workflow uses std-container-run or std-container-session). */
  logs?: RunLogEntry[];
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

/** Build full shell/container log text for copying and for the debug block (includes stdout, stderr, meta). */
function buildShellAndContainerLogText(logs: RunLogEntry[]): string {
  if (!Array.isArray(logs) || logs.length === 0) return "";
  return logs.map((e) => `[${e.level}] ${e.message}`).join("\n");
}

/** Build a paste-ready block for the user to copy into chat for debugging. Includes full shell/container logs. */
function buildCopyForChatBlock(run: Run): string {
  const lines: string[] = [
    "[Agentron run]",
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
    const runError = (out.error ?? (out.errorDetails as { message?: string })?.message) ?? "";
    const isWaitingForUser = run.status === "waiting_for_user" || runError === WAITING_FOR_USER_MESSAGE;
    if (out.success === false && runError && !isWaitingForUser) {
      lines.push("");
      lines.push("Error: " + runError);
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
    if (run.status === "waiting_for_user") {
      const q = (out as { question?: string }).question ?? (out as { message?: string }).message;
      if (typeof q === "string" && q.trim()) {
        lines.push("");
        lines.push("Question: " + q.trim());
      }
      const sug = (out as { suggestions?: string[] }).suggestions;
      if (Array.isArray(sug) && sug.length > 0) {
        lines.push("Suggestions: " + sug.filter((s): s is string => typeof s === "string").join(", "));
      }
    }
    const trailSteps = (out as { trail?: ExecutionTraceStep[] }).trail;
    if (Array.isArray(trailSteps) && trailSteps.length > 0) {
      lines.push("");
      lines.push("Execution trail:");
      for (const s of trailSteps.sort((a, b) => a.order - b.order)) {
        lines.push(`  #${s.order + 1} ${s.agentName} (${s.nodeId})`);
        if (s.toolCalls && s.toolCalls.length > 0) {
          lines.push("    Tools invoked: " + s.toolCalls.map((t) => t.argsSummary ? `${t.name} (${t.argsSummary})` : t.name).join(", "));
        }
        if (s.input !== undefined) lines.push("    Input: " + JSON.stringify(s.input));
        if (s.output !== undefined) lines.push("    Output: " + (typeof s.output === "string" ? s.output : JSON.stringify(s.output)));
        if (s.error) lines.push(s.error === WAITING_FOR_USER_MESSAGE ? "    Waiting for user input" : "    Error: " + s.error);
      }
    }
  }
  const shellLogText = buildShellAndContainerLogText(run.logs ?? []);
  if (shellLogText) {
    lines.push("");
    lines.push("Shell / container logs:");
    lines.push(shellLogText);
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

/** True when step.output looks like Run Container / shell tool result (stdout, stderr, exitCode). */
function isContainerLikeOutput(raw: unknown): raw is { stdout?: string; stderr?: string; error?: string; exitCode?: number } {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return false;
  const o = raw as Record<string, unknown>;
  return "stdout" in o || "stderr" in o || ("exitCode" in o && typeof o.exitCode === "number");
}

/** Extract shell/execution log lines from trail steps (stdout, stderr from tools). */
function buildShellLog(trail: ExecutionTraceStep[]): string {
  const lines: string[] = [];
  const sorted = trail.slice().sort((a, b) => a.order - b.order);
  for (const step of sorted) {
    let o: Record<string, unknown> | null = null;
    const raw = step.output;
    if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
      o = raw as Record<string, unknown>;
    } else if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
          o = parsed as Record<string, unknown>;
        }
      } catch {
        /* not JSON */
      }
    }
    const stdout = o && typeof o.stdout === "string" ? o.stdout : undefined;
    const stderr = o && typeof o.stderr === "string" ? o.stderr : undefined;
    const err = o && typeof o.error === "string" ? o.error : undefined;
    const exitCode = o && o.exitCode !== undefined ? String(o.exitCode) : undefined;
    const hasStructuredOutput = stdout || stderr || err || (exitCode !== undefined && exitCode !== "0");
    const hasStepError = !!step.error;
    const hasStringOutput = !hasStructuredOutput && typeof raw === "string" && raw.trim() !== "";
    if (hasStructuredOutput || hasStepError || hasStringOutput) {
      if (lines.length) lines.push("");
      const stepLabel = hasStructuredOutput ? `Step ${step.order + 1} — Run Container output (${step.agentName})` : `${step.agentName} (step ${step.order + 1})`;
      lines.push(`# ${stepLabel}`);
      if (stdout) {
        lines.push("--- stdout ---");
        lines.push(stdout);
      }
      if (stderr) {
        lines.push("--- stderr ---");
        lines.push(stderr);
      }
      if (err) {
        lines.push("--- error ---");
        lines.push(err);
      }
      if (exitCode !== undefined && exitCode !== "0") {
        lines.push(`--- exit code: ${exitCode} ---`);
      }
      if (hasStepError) {
        if (step.error === WAITING_FOR_USER_MESSAGE) {
          lines.push("▶ Waiting for your input (reply in Chat or on the run page).");
        } else {
          lines.push("--- step error ---");
          lines.push(step.error!);
        }
      }
      if (hasStringOutput) {
        lines.push("--- output ---");
        lines.push(raw as string);
      }
    }
  }
  return lines.join("\n");
}

function TrailStepCard({
  step,
  outputsOnly,
}: {
  step: ExecutionTraceStep;
  index: number;
  outputsOnly: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasInput = !outputsOnly && step.input !== undefined && step.input !== null;
  const hasOutput = step.output !== undefined && step.output !== null;
  const isWaitingForUser = step.error === WAITING_FOR_USER_MESSAGE;
  const hasError = !!step.error && !isWaitingForUser;
  const toolCalls = step.toolCalls ?? [];
  const containerWasInvoked = toolCalls.some((t) => t.name === "std-container-run" || t.name === "std-container-session");
  const showNoContainerWarning = isWaitingForUser && !containerWasInvoked && toolCalls.length > 0;

  return (
    <div className="run-trail-step">
      <button type="button" className="run-trail-step-header" onClick={() => setExpanded(!expanded)}>
        <span className="run-trail-step-num">#{step.order + 1}</span>
        {step.round !== undefined && (
          <span className="run-trail-step-round">Round {step.round + 1}</span>
        )}
        <span className="run-trail-step-name">{step.agentName}</span>
        <span className="run-trail-step-node">({step.nodeId})</span>
        {isWaitingForUser && (
          <span className="run-trail-step-waiting-badge">
            Waiting for your input
          </span>
        )}
        {hasError && <span className="run-trail-step-error-badge">Error</span>}
      </button>
      {expanded && (
        <div className="run-trail-step-body">
          {toolCalls.length > 0 && (
            <div style={{ marginBottom: "0.75rem" }}>
              <div className="run-trail-step-field-label">Tools invoked</div>
              <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.9rem", lineHeight: 1.5 }}>
                {toolCalls.map((t, i) => (
                  <li key={i}>
                    <code style={{ fontSize: "0.85em" }}>{t.name}</code>
                    {t.argsSummary != null && (
                      <span style={{ color: "var(--text-muted)", marginLeft: "0.35rem" }}> — {t.argsSummary}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {showNoContainerWarning && (
            <div
              style={{
                padding: "0.5rem 0.75rem",
                marginBottom: "0.75rem",
                background: "var(--resource-amber)",
                color: "var(--bg)",
                borderRadius: 6,
                fontSize: "0.85rem",
                fontWeight: 500,
              }}
            >
              No Podman/container command was run in this step. The agent requested your input without calling Run Container or Container session first.
            </div>
          )}
          {hasInput && (
            <div>
              <div className="run-trail-step-field-label">Input</div>
              <pre className="run-trail-step-pre">{formatValue(step.input)}</pre>
            </div>
          )}
          {hasOutput && isContainerLikeOutput(step.output) && (
            <div style={{ marginTop: "0.75rem" }}>
              <div className="run-trail-step-field-label" style={{ marginBottom: "0.35rem" }}>Command output</div>
              <div className="run-shell-terminal" style={{ fontSize: "0.85rem" }}>
                <pre className="run-shell-terminal-body" style={{ margin: 0, padding: "0.75rem", maxHeight: "16rem", overflow: "auto" }}>
                  {(step.output as { stdout?: string }).stdout && (
                    <>
                      <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>stdout</span>
                      {"\n"}
                      {(step.output as { stdout: string }).stdout}
                      {"\n"}
                    </>
                  )}
                  {(step.output as { stderr?: string }).stderr && (
                    <>
                      <span style={{ color: "var(--resource-red)", fontWeight: 600 }}>stderr</span>
                      {"\n"}
                      {(step.output as { stderr: string }).stderr}
                      {"\n"}
                    </>
                  )}
                  {(step.output as { error?: string }).error && (
                    <>
                      <span style={{ color: "var(--resource-red)", fontWeight: 600 }}>error</span>
                      {"\n"}
                      {(step.output as { error: string }).error}
                      {"\n"}
                    </>
                  )}
                  {(step.output as { exitCode?: number }).exitCode !== undefined && (
                    <span style={{ color: "var(--text-muted)" }}>
                      exit code: {(step.output as { exitCode: number }).exitCode}
                    </span>
                  )}
                </pre>
              </div>
            </div>
          )}
          {hasOutput && !isContainerLikeOutput(step.output) && (
            <div>
              <div className="run-trail-step-field-label">Output</div>
              <pre className="run-trail-step-pre">{formatValue(step.output)}</pre>
            </div>
          )}
          {isWaitingForUser && (
            <div style={{ padding: "0.5rem 0", color: "var(--text-muted)", fontSize: "0.9rem" }}>
              Reply in Chat or on this run page to continue.
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
  const [showOutputsOnly, setShowOutputsOnly] = useState(true);
  const [liveShellCopied, setLiveShellCopied] = useState(false);
  const [shellTraceCopied, setShellTraceCopied] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [submittingReply, setSubmittingReply] = useState(false);
  const liveLogEndRef = useRef<HTMLDivElement | null>(null);

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

  // Poll for updates while the run is in progress so the user sees new trail steps, live logs, and output
  useEffect(() => {
    if (run?.status !== "running") return;
    const interval = setInterval(() => void load(true), 800);
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

  const handleCopyLiveShell = useCallback(() => {
    if (!run) return;
    const text = run.logs?.length
      ? buildShellAndContainerLogText(run.logs)
      : (() => {
          const out = run.output;
          const trail = out && typeof out === "object" && Array.isArray((out as { trail?: ExecutionTraceStep[] }).trail)
            ? (out as { trail: ExecutionTraceStep[] }).trail
            : [];
          return buildShellLog(trail);
        })();
    if (!text.trim()) return;
    void copyToClipboard(text).then((ok) => {
      if (ok) {
        setLiveShellCopied(true);
        setTimeout(() => setLiveShellCopied(false), 2000);
      }
    });
  }, [run]);

  const handleCopyShellTrace = useCallback(
    (stackTrace: string, shellLogFromTrail: string) => {
      const logsText = run?.logs?.length ? buildShellAndContainerLogText(run.logs) : shellLogFromTrail;
      const text = stackTrace ? (stackTrace + (logsText ? "\n\n" + logsText : "")) : logsText;
      if (!text.trim()) return;
      void copyToClipboard(text).then((ok) => {
        if (ok) {
          setShellTraceCopied(true);
          setTimeout(() => setShellTraceCopied(false), 2000);
        }
      });
    },
    [run?.logs]
  );

  const scrollToId = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const handleSubmitReply = useCallback(async () => {
    if (!id || !run || run.status !== "waiting_for_user") return;
    const text = replyText.trim() || "(no text)";
    setSubmittingReply(true);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(id)}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: text }),
      });
      if (res.ok) {
        setReplyText("");
        await load(true);
      }
    } finally {
      setSubmittingReply(false);
    }
  }, [id, run, replyText, load]);

  const handleStopRun = useCallback(async () => {
    if (!id || !run || (run.status !== "running" && run.status !== "waiting_for_user")) return;
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

  // Auto-scroll live container output to bottom when new logs arrive (must be before any early return)
  useEffect(() => {
    const logs = run?.logs ?? [];
    const displayCount = logs.filter((e: { level?: string }) => e.level !== "meta").length;
    if (displayCount > 0 && liveLogEndRef.current) {
      liveLogEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [run?.logs?.length ?? 0]);

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
  const runLevelError = out && typeof out === "object" && ((out as { error?: string }).error ?? (out.errorDetails as { message?: string })?.message);
  const hasError =
    run.status !== "waiting_for_user" &&
    runLevelError !== WAITING_FOR_USER_MESSAGE &&
    !!out &&
    typeof out === "object" &&
    (out.success === false || !!runLevelError);
  const debugBlock = buildCopyForChatBlock(run);
  const trail = (out && typeof out === "object" && Array.isArray((out as { trail?: ExecutionTraceStep[] }).trail))
    ? (out as { trail: ExecutionTraceStep[] }).trail
    : [];
  const hasStack = hasError && out && typeof out === "object" && (out.errorDetails as { stack?: string })?.stack;
  const stackTrace = hasStack && out && typeof out === "object" ? (out.errorDetails as { stack: string }).stack : "";
  const shellLogFromTrail = buildShellLog(trail);
  const runLogs = run.logs ?? [];
  const hasLiveLogs = runLogs.length > 0 || run.status === "running";
  // Only stdout/stderr for display; meta entries are used for container status
  const displayLogs = runLogs.filter((e) => e.level !== "meta");
  // Shell & stack trace: prefer persisted run_logs history when available, else trail-derived output
  const hasShellHistory = displayLogs.length > 0 || shellLogFromTrail.trim() !== "";
  const lastMeta = [...runLogs].reverse().find((e) => e.level === "meta");
  const containerRunning =
    run.status === "running" && lastMeta?.message === "container_started";
  const containerStatus =
    run.status === "waiting_for_user" && displayLogs.length === 0
      ? "not_started"
      : containerRunning
        ? "running"
        : run.status === "running"
          ? "not_running"
          : displayLogs.length > 0 || (run.status === "completed" && shellLogFromTrail.trim() !== "")
            ? "finished"
            : "none";

  return (
    <div className="page-content run-detail-page">
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
            {(run.status === "running" || run.status === "waiting_for_user") && (
              <button
                type="button"
                className="button button-secondary"
                onClick={handleStopRun}
                disabled={stopping}
                style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
              >
                {stopping ? <Loader2 size={14} className="spin" /> : <Square size={14} />}
                {stopping ? "Stopping…" : run.status === "waiting_for_user" ? "Cancel run" : "Stop run"}
              </button>
            )}
          </div>
        </div>
        {run.status === "running" && (
          <div className="run-detail-section" style={{ paddingTop: "0.25rem" }}>
            <div className="run-detail-label" style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Container</div>
            <div className="run-detail-value" style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.9rem" }}>
              {containerRunning ? (
                <>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "var(--resource-green)",
                      flexShrink: 0,
                      boxShadow: "0 0 6px var(--resource-green)",
                    }}
                    aria-hidden
                    title="Container is running"
                  />
                  <span>Running — see Live container output below</span>
                </>
              ) : (
                <>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "var(--text-muted)",
                      flexShrink: 0,
                    }}
                    aria-hidden
                    title="No container running"
                  />
                  <span style={{ color: "var(--text-muted)" }}>Not running</span>
                </>
              )}
            </div>
          </div>
        )}
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

      {/* Run context summary (same kind of info the Chat assistant shows for debugging) */}
      <div className="run-detail-card" style={{ marginBottom: "1rem", background: "var(--surface-muted)", borderLeft: "4px solid var(--primary)" }}>
        <div className="run-detail-section">
          <div className="run-detail-label" style={{ marginBottom: "0.5rem" }}>Run context</div>
          <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.9rem", lineHeight: 1.6, color: "var(--text)" }}>
            <li><strong>Run status:</strong> {run.status}</li>
            <li><strong>Run id:</strong> <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.85rem" }}>{run.id}</span></li>
            <li>
              <strong>Workflow:</strong>{" "}
              {run.targetType === "workflow" ? `${run.targetName ?? "Workflow"} (${run.targetId})` : `${run.targetType} — ${run.targetId}`}
            </li>
            <li>
              <strong>Agent:</strong>{" "}
              {trail.length > 0
                ? (() => {
                    const sorted = trail.slice().sort((a, b) => b.order - a.order);
                    const last = sorted[0];
                    return `${last.agentName} (${last.nodeId})`;
                  })()
                : "—"}
            </li>
            <li>
              <strong>State:</strong>{" "}
              {run.status === "waiting_for_user"
                ? `Waiting for your input — the workflow is paused${trail.length > 0 ? ` at ${trail.slice().sort((a, b) => b.order - a.order)[0]?.nodeId}` : ""} waiting for your response.`
                : run.status === "running"
                  ? "Running — agents are executing."
                  : run.status === "completed"
                    ? "Completed."
                    : run.status === "failed"
                      ? "Failed."
                      : run.status === "cancelled"
                        ? "Cancelled."
                        : run.status}
            </li>
            {run.targetType === "workflow" && (() => {
              const stepWithContainer = trail.find((s) => s.toolCalls?.some((t) => t.name === "std-container-run" || t.name === "std-container-session"));
              const anyToolCalls = trail.some((s) => (s.toolCalls?.length ?? 0) > 0);
              if (stepWithContainer) {
                return (
                  <li>
                    <strong>Container (Podman):</strong> Invoked in step #{stepWithContainer.order + 1} — see <strong>Execution trail</strong> (Tools invoked) and <strong>Command output</strong> below.
                  </li>
                );
              }
              if (run.status === "waiting_for_user" && anyToolCalls) {
                return (
                  <li style={{ color: "var(--resource-amber)", fontWeight: 500 }}>
                    <strong>Container (Podman):</strong> Not invoked. The agent requested your input without calling Run Container or Container session first. See <strong>Execution trail</strong> → <strong>Tools invoked</strong> for what the agent actually called.
                  </li>
                );
              }
              return (
                <li>
                  <strong>Container (Podman):</strong> {anyToolCalls ? "Not invoked in this run." : "No tool calls recorded yet."}
                </li>
              );
            })()}
            {trail.length > 0 && (() => {
              const sorted = trail.slice().sort((a, b) => b.order - a.order);
              const last = sorted[0];
              const inputStr = last.input !== undefined ? (typeof last.input === "string" ? last.input : JSON.stringify(last.input)) : "—";
              const statusStr = last.error === WAITING_FOR_USER_MESSAGE ? "Waiting for your input" : (last.error ? last.error : "Completed");
              return (
                <li>
                  <strong>Trail:</strong> Last step — input: &quot;{inputStr.length > 60 ? inputStr.slice(0, 57) + "…" : inputStr}&quot;, status: {statusStr}
                </li>
              );
            })()}
            <li style={{ color: "var(--text-muted)", marginTop: "0.25rem" }}>
              <strong>Note:</strong> There is no long-lived container — the agent runs one-off container commands; stdout/stderr appear in <strong>Live container output</strong> below when it does. Send a message in Chat (with this run in context) to interact with the agent.
            </li>
          </ul>
        </div>
      </div>

      {/* Live container output: show when we have logs, trail-derived output, or run is active */}
      {(run.targetType === "workflow" && (hasLiveLogs || run.status === "running" || run.status === "waiting_for_user" || (run.status === "completed" && hasShellHistory))) && (
        <div id="live-container-output" className="run-detail-card run-detail-shell-card" style={{ marginBottom: "1rem", scrollMarginTop: "1rem" }}>
          <div className="run-detail-section" style={{ marginBottom: "0.75rem" }}>
            <div className="run-detail-label" style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <Terminal size={16} /> Live container output
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
              <span
                className={`run-detail-container-badge run-detail-container-badge-${containerStatus}`}
              >
                {containerStatus === "running" && (
                  <span className="run-detail-container-badge-dot" aria-hidden />
                )}
                {containerStatus === "running" && "Container: Running"}
                {containerStatus === "not_running" && "Container: Not running"}
                {containerStatus === "not_started" && "Container: Not started (run paused)"}
                {containerStatus === "finished" && "Container: Finished"}
                {containerStatus === "none" && "Container: No output yet"}
              </span>
              {containerStatus === "running" && (
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Streaming stdout/stderr below.</span>
              )}
            </div>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0.5rem 0 0 0" }}>
              {displayLogs.length > 0
                ? "Stdout and stderr from the container command, streamed in real time. The same output is also captured in Execution trail (per step) and Shell & stack trace."
                : "When the agent runs a container command, stdout and stderr stream here in real time. You can also see command output in Execution trail (expand the step) and in Shell & stack trace."}
            </p>
          </div>
          <div className="run-shell-terminal">
            <div className="run-shell-terminal-header">
              <span className="run-shell-terminal-dots">
                <span className="run-shell-terminal-dot run-shell-terminal-dot-red" aria-hidden />
                <span className="run-shell-terminal-dot run-shell-terminal-dot-yellow" aria-hidden />
                <span className="run-shell-terminal-dot run-shell-terminal-dot-green" aria-hidden />
              </span>
              <span className="run-shell-terminal-title">Shell output</span>
              {hasShellHistory && (
                <button
                  type="button"
                  className="run-shell-terminal-copy"
                  onClick={handleCopyLiveShell}
                  title="Copy shell output"
                >
                  {liveShellCopied ? <CheckCircle size={12} /> : <Copy size={12} />}
                  {liveShellCopied ? "Copied" : "Copy"}
                </button>
              )}
            </div>
            <pre className="run-shell-terminal-body" style={{ maxHeight: "20rem", overflow: "auto" }}>
              {displayLogs.length > 0
                ? (
                    <>
                      {displayLogs.map((entry, i) => (
                        <span
                          key={i}
                          style={{
                            display: "block",
                            color: entry.level === "stderr" ? "var(--resource-red)" : undefined,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-all",
                          }}
                        >
                          {entry.message}
                        </span>
                      ))}
                      {run.status === "waiting_for_user" && (
                        <span style={{ display: "block", marginTop: "0.75rem", color: "var(--resource-amber)", fontWeight: 500 }}>
                          ▶ Waiting for your input (reply in Chat or on the run page).
                        </span>
                      )}
                    </>
                  )
                : shellLogFromTrail.trim() !== "" && (run.status === "waiting_for_user" || run.status === "running" || run.status === "completed")
                  ? (
                      <>
                        <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{shellLogFromTrail}</span>
                        {run.status === "waiting_for_user" && (
                          <span style={{ display: "block", marginTop: "0.75rem", color: "var(--resource-amber)", fontWeight: 500 }}>
                            ▶ Waiting for your input (reply in Chat or on the run page).
                          </span>
                        )}
                      </>
                    )
                  : run.status === "waiting_for_user"
                    ? "Run is paused waiting for your input. No container has been started yet.\n\nAfter you reply in Chat, if the agent runs a container command, stdout and stderr will stream here in real time."
                    : run.status === "running"
                      ? "No container output yet. When the agent runs a container command, output will stream here in real time."
                      : "No container output for this run. When the agent runs a container command, stdout and stderr stream here."}
            <div ref={liveLogEndRef} />
            </pre>
          </div>
        </div>
      )}

      <div className="run-detail-main-grid">
      {out != null && typeof out === "object" && (
        <div className="run-detail-card run-detail-output-card run-detail-grid-card">
          <div className="run-detail-section" style={{ marginBottom: "0.5rem", flexShrink: 0 }}>
            <div className="run-detail-label">{hasError ? "Error" : run.status === "waiting_for_user" ? "Status" : "Output"}</div>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0.25rem 0 0 0" }}>
              {hasError
                ? "Error message and stack. Hints for container or LLM issues appear below when relevant."
                : run.status === "waiting_for_user"
                  ? "Run is paused; reply in Chat or on this page to continue."
                  : "Run result payload and final output."}
            </p>
          </div>
          <div className="run-detail-output-body">
            <div className="run-detail-output-content">
              {run.status === "waiting_for_user" && !hasError ? (
                <div className="run-detail-value">
                  <p style={{ margin: "0 0 0.75rem 0", fontWeight: 500 }}>
                    {(out as { question?: string }).question ?? (out as { message?: string }).message ?? "Waiting for your input."}
                  </p>
                  {Array.isArray((out as { suggestions?: string[] }).suggestions) && ((out as { suggestions: string[] }).suggestions.length > 0) ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginBottom: "0.75rem" }}>
                      {((out as { suggestions: string[] }).suggestions as string[]).filter((s): s is string => typeof s === "string").map((s, i) => (
                        <button
                          key={i}
                          type="button"
                          className="button button-ghost button-small"
                          style={{ fontSize: "0.85rem" }}
                          onClick={() => setReplyText((prev) => (prev ? prev + " " + s : s))}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <form
                    onSubmit={(e) => { e.preventDefault(); void handleSubmitReply(); }}
                    style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "32rem" }}
                  >
                    <textarea
                      className="run-detail-value"
                      placeholder="Type your response…"
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      rows={3}
                      style={{ resize: "vertical", minHeight: "4rem" }}
                      aria-label="Response to send to the workflow"
                    />
                    <button
                      type="submit"
                      className="button button-success"
                      disabled={submittingReply}
                      style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
                    >
                      {submittingReply ? <Loader2 size={14} className="spin" /> : <MessageCircle size={14} />}
                      {submittingReply ? "Sending…" : "Send response"}
                    </button>
                  </form>
                  <p style={{ margin: "0.5rem 0 0 0", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                    You can also reply in Chat with the run context from &quot;Copy for chat&quot; below.
                  </p>
                </div>
              ) : hasError ? (
                <div className="run-detail-value" style={{ color: "var(--resource-red)" }}>
                  {(out as { error?: string }).error ?? (out.errorDetails as { message?: string })?.message ?? "Unknown error"}
                </div>
              ) : (
                <div className="run-detail-value" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {(out as { output?: unknown }).output !== undefined
                    ? typeof (out as { output: unknown }).output === "string"
                      ? (out as { output: string }).output
                      : JSON.stringify((out as { output: unknown }).output, null, 2)
                    : JSON.stringify(out, null, 2)}
                </div>
              )}
              {hasError && (() => {
              const errMsg = (out as { error?: string }).error ?? (out.errorDetails as { message?: string })?.message ?? "";
              const isContainerUnavailable = /enoent|command not found|is not recognized|not found: ['"]?(podman|docker)['"]?/i.test(errMsg);
              if (isContainerUnavailable) {
                const isEnoent = /enoent/i.test(errMsg);
                return (
                  <div className="run-detail-value" style={{ marginTop: "1rem", padding: "0.75rem 1rem", background: "var(--surface-muted)", borderRadius: 8, borderLeft: "3px solid var(--primary)", fontSize: "0.9rem" }}>
                    <strong style={{ display: "block", marginBottom: "0.35rem" }}>Container runtime not found</strong>
                    <p style={{ margin: 0, color: "var(--text-muted)" }}>Install Docker or Podman to run workflows that use containers:</p>
                    <ul style={{ margin: "0.5rem 0 0 1.25rem", padding: 0 }}>
                      <li><a href="https://docs.docker.com/get-docker/" target="_blank" rel="noopener noreferrer" style={{ color: "var(--primary)" }}>Docker</a></li>
                      <li><a href="https://podman.io/getting-started/installation" target="_blank" rel="noopener noreferrer" style={{ color: "var(--primary)" }}>Podman</a></li>
                    </ul>
                    {isEnoent && (
                      <p style={{ margin: "0.5rem 0 0 0", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                        If Podman/Docker works in your terminal, start the dev server from that same terminal so it inherits the same PATH.
                      </p>
                    )}
                    <p style={{ margin: "0.5rem 0 0 0", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                      Configure in <Link href="/settings/container" style={{ color: "var(--primary)" }}>Settings → Container Engine</Link>.
                    </p>
                  </div>
                );
              }
              if (run.targetType === "workflow") {
                return (
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
                );
              }
              return null;
            })()}
            </div>
          </div>
        </div>
      )}

      {trail.length > 0 && (
        <div id="execution-trail" className="run-detail-card run-detail-trail-card run-detail-grid-card" style={{ scrollMarginTop: "1rem" }}>
          <div className="run-detail-section" style={{ marginBottom: "0.5rem" }}>
            <div className="run-detail-label" style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <GitBranch size={16} /> Execution trail
            </div>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0.25rem 0 0 0" }}>
              Chronological steps: which agent ran at each step (by order and round). Expand a step to see input and output. When an agent runs a container command, its <strong>Command output</strong> (stdout/stderr/exit code) appears here and in <strong>Shell &amp; stack trace</strong> below.
            </p>
            <label className="run-trail-toggle">
              <input
                type="checkbox"
                checked={showOutputsOnly}
                onChange={(e) => setShowOutputsOnly(e.target.checked)}
              />
              <span className="run-trail-toggle-icon">
                {showOutputsOnly ? <Eye size={14} /> : <EyeOff size={14} />}
              </span>
              Show only outputs
            </label>
          </div>
          <div className="run-detail-trail-list" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {trail
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((step, i) => (
                <TrailStepCard
                  key={`${step.nodeId}-${step.order}`}
                  step={step}
                  index={i}
                  outputsOnly={showOutputsOnly}
                />
              ))}
          </div>
        </div>
      )}

      {out != null && typeof out === "object" && (
        <div className="run-detail-card run-detail-shell-card run-detail-shell-card-large run-detail-grid-card">
          <div className="run-detail-section" style={{ marginBottom: "0.5rem", flexShrink: 0 }}>
            <div className="run-detail-label" style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <Terminal size={16} /> Shell & stack trace
            </div>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0.25rem 0 0 0" }}>
              Command output (stdout/stderr) from each step that ran a container, persisted and shown in full. Plus any error stack traces. Same history as Live container output when available.
            </p>
          </div>
          {stackTrace || hasShellHistory ? (
            <div className="run-shell-terminal run-shell-terminal-fill">
              <div className="run-shell-terminal-header">
                <span className="run-shell-terminal-dots">
                  <span className="run-shell-terminal-dot run-shell-terminal-dot-red" aria-hidden />
                  <span className="run-shell-terminal-dot run-shell-terminal-dot-yellow" aria-hidden />
                  <span className="run-shell-terminal-dot run-shell-terminal-dot-green" aria-hidden />
                </span>
                <span className="run-shell-terminal-title">Terminal</span>
                <button
                  type="button"
                  className="run-shell-terminal-copy"
                  onClick={() => handleCopyShellTrace(stackTrace, shellLogFromTrail)}
                  title="Copy shell output and stack trace"
                >
                  {shellTraceCopied ? <CheckCircle size={12} /> : <Copy size={12} />}
                  {shellTraceCopied ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="run-shell-terminal-body run-shell-terminal-body-large">
                {stackTrace ? stackTrace : null}
                {stackTrace && hasShellHistory ? "\n\n" : null}
                {displayLogs.length > 0
                  ? displayLogs.map((entry, i) => (
                      <span
                        key={i}
                        style={{
                          display: "block",
                          color: entry.level === "stderr" ? "var(--resource-red)" : undefined,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-all",
                        }}
                      >
                        {entry.message}
                      </span>
                    ))
                  : shellLogFromTrail.trim()
                    ? shellLogFromTrail
                    : null}
              </pre>
            </div>
          ) : (
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: 0 }}>
              No program/shell output or stack trace for this run.
            </p>
          )}
        </div>
      )}

      </div>

      <div className="run-detail-card run-detail-feedback-card">
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
              <div className="run-feedback-field">
                <label htmlFor="run-feedback-notes" className="run-feedback-label">Optional notes</label>
                <textarea
                  id="run-feedback-notes"
                  className="run-feedback-textarea"
                  placeholder="e.g. what to improve, what went wrong, or what worked well"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  aria-describedby="run-feedback-notes-hint"
                />
                <span id="run-feedback-notes-hint" className="run-feedback-hint">
                  Add context to help improve future runs.
                </span>
              </div>
              <div className="run-feedback-actions">
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
