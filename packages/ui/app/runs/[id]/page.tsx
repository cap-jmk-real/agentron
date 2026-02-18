"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Copy, CheckCircle, XCircle, Clock, Loader2, MessageCircle, GitBranch, Square, ThumbsUp, ThumbsDown, Terminal, Eye, EyeOff, ListOrdered } from "lucide-react";
import { openChatWithContext } from "../../components/chat-wrapper";

/** When the agent calls request_user_help, the workflow throws this message; we treat it as "waiting for input", not a failure. */
const WAITING_FOR_USER_MESSAGE = "WAITING_FOR_USER";

/** Whether the agent's prompt is too vague for the user to know what to do (e.g. "Choose one:" with no list). */
function isVagueWaitingPrompt(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length < 30) return true;
  const vague = ["choose one", "pick one", "select one", "need your input", "your input", "your response"];
  return vague.some((v) => t === v || t === v + ":" || t === v + ".");
}

/** Extract the question/message to show when run is waiting_for_user (from run.output payload). */
function getWaitingForUserMessage(out: unknown): string {
  if (!out || typeof out !== "object") return "Waiting for your input.";
  const o = out as Record<string, unknown>;
  const q = typeof o.question === "string" && o.question.trim() ? o.question.trim() : "";
  if (q && !isVagueWaitingPrompt(q)) return q;
  const m = typeof o.message === "string" && o.message.trim() ? o.message.trim() : "";
  if (m && !isVagueWaitingPrompt(m)) return m;
  const r = typeof o.reason === "string" && o.reason.trim() ? o.reason.trim() : "";
  if (r && !isVagueWaitingPrompt(r)) return r;
  return "Waiting for your input.";
}

/** When the agent's prompt is vague, show this so the user knows what to do. */
const WAITING_WHAT_TO_DO =
  "The agent is waiting for your input. Reply in the box below (or in Chat) with your answer — for example, type the name or number of the item you want (e.g. which saved search to use), or describe your choice.";

type ExecutionTraceStep = {
  nodeId: string;
  agentId: string;
  agentName: string;
  order: number;
  round?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
  toolCalls?: Array<{ name: string; argsSummary?: string; resultSummary?: string }>;
  /** When true, this step's input is the user's reply to request_user_help (agent received it). */
  inputIsUserReply?: boolean;
};

type RunLogEntry = { level: string; message: string; payload?: string | null; createdAt: number };

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
  return logs
    .map((e) => {
      let line = `[${e.level}] ${e.message}`;
      if (e.payload != null && e.payload !== "") {
        try {
          const p = JSON.parse(e.payload) as Record<string, unknown>;
          if (p && typeof p === "object" && !Array.isArray(p)) {
            const parts = Object.entries(p)
              .filter(([, v]) => v !== undefined && v !== null && v !== "")
              .map(([k, v]) => `${k}: ${typeof v === "string" && v.length > 80 ? v.slice(0, 77) + "…" : v}`);
            if (parts.length > 0) line += " " + parts.join(", ");
          }
        } catch {
          line += " " + (e.payload.length > 80 ? e.payload.slice(0, 77) + "…" : e.payload);
        }
      }
      return line;
    })
    .join("\n");
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
    const payloadOut = out && typeof out === "object" ? (out as { output?: { userResponded?: boolean; response?: string } }).output : undefined;
    if (payloadOut && typeof payloadOut === "object" && payloadOut.userResponded && typeof payloadOut.response === "string" && payloadOut.response !== "") {
      lines.push("");
      lines.push("User replied: " + payloadOut.response);
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
      lines.push("");
      lines.push(`→ Reply on the run page or in Chat (open /chat?runId=${run.id}) so the agent can continue.`);
    }
    const trailSteps = (out as { trail?: ExecutionTraceStep[] }).trail;
    if (Array.isArray(trailSteps) && trailSteps.length > 0) {
      const sorted = trailSteps.slice().sort((a, b) => a.order - b.order);
      lines.push("");
      lines.push("What happened (chronological: oldest at top, newest at bottom):");
      for (const s of sorted) {
        if (s.inputIsUserReply && s.input != null) {
          const reply = extractUserReplyFromPartnerMessage(s.input);
          if (reply != null) lines.push(`  • You replied: ${reply}`);
        }
        for (const t of s.toolCalls ?? []) {
          const part = t.argsSummary ? `${t.name} (${t.argsSummary})` : t.name;
          const result = t.resultSummary != null ? ` → ${t.resultSummary}` : "";
          lines.push(`  • ${part}${result}`);
        }
      }
      lines.push("");
      lines.push("Execution trail (step details):");
      for (const s of sorted) {
        lines.push(`  #${s.order + 1} ${s.agentName} (${s.nodeId})`);
        if (s.input !== undefined) {
          if (s.inputIsUserReply) {
            const yourReply = extractUserReplyFromPartnerMessage(s.input);
            if (yourReply != null) lines.push("    Your reply: " + yourReply);
            lines.push("    User reply (agent received): " + (typeof s.input === "string" ? s.input : JSON.stringify(s.input)));
          } else {
            lines.push("    Input: " + (typeof s.input === "string" ? s.input : JSON.stringify(s.input)));
          }
        }
        if (s.toolCalls && s.toolCalls.length > 0) {
          lines.push("    Tools invoked: " + s.toolCalls.map((t) => {
            const part = t.argsSummary ? `${t.name} (${t.argsSummary})` : t.name;
            return t.resultSummary != null ? `${part} → ${t.resultSummary}` : part;
          }).join("; "));
        }
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

/** Tool returned { error: string } or { success: false, error: string } (e.g. browser connection failure). */
function getToolErrorFromOutput(output: unknown): string | null {
  if (output == null || typeof output !== "object" || Array.isArray(output)) return null;
  const o = output as Record<string, unknown>;
  if (typeof o.error === "string" && o.error.trim()) return o.error.trim();
  return null;
}

/** One-line "what went wrong" summary from run_logs (for failed/waiting runs). */
function buildWhatWentWrongOneLiner(logs: Array<{ level: string; message: string; payload?: string | null }>): string {
  if (!Array.isArray(logs) || logs.length === 0) return "";
  const errOrStderr = logs.filter((e) => e.level === "stderr" || (e.message && /\[.*\]/.test(e.message)));
  if (errOrStderr.length === 0) return "";
  const parts = errOrStderr.slice(-10).map((e) => {
    const m = e.message.replace(/\n/g, " ").trim();
    const sourceMatch = m.match(/^\[([^\]]+)\]/);
    const source = sourceMatch ? sourceMatch[1] : e.level;
    const rest = sourceMatch ? m.slice(sourceMatch[0].length).trim() : m;
    const short = rest.length > 60 ? rest.slice(0, 57) + "…" : rest;
    return `[${source}] ${short}`;
  });
  const n = errOrStderr.length;
  if (n <= 3) return parts.join("; ");
  return `${n} errors: ${parts.slice(-2).join("; ")}`;
}

/** Extract the user's actual reply from the partner message (e.g. "The user has replied: \"Approve vault\". ..."). */
function extractUserReplyFromPartnerMessage(input: unknown): string | null {
  if (typeof input !== "string" || !input.trim()) return null;
  const m = input.match(/(?:replied|reply):\s*["']([^"']*)["']/i) ?? input.match(/"([^"]+)"/);
  return m?.[1]?.trim() ?? null;
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
  runId,
}: {
  step: ExecutionTraceStep;
  index: number;
  outputsOnly: boolean;
  runId?: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasInput = !outputsOnly && step.input !== undefined && step.input !== null;
  const hasOutput = step.output !== undefined && step.output !== null;
  const toolOutputError = hasOutput ? getToolErrorFromOutput(step.output) : null;
  const isWaitingForUser = step.error === WAITING_FOR_USER_MESSAGE;
  const hasError = (!!step.error && !isWaitingForUser) || !!toolOutputError;
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
          {/* Chronological order: input (e.g. your reply) first, then tool calls, then results */}
          {hasInput && (
            <div style={{ marginBottom: "0.75rem" }}>
              {step.inputIsUserReply ? (
                <>
                  {(() => {
                    const yourReply = extractUserReplyFromPartnerMessage(step.input);
                    return yourReply != null ? (
                      <div style={{ marginBottom: "0.5rem" }}>
                        <div className="run-trail-step-field-label">Your reply</div>
                        <pre className="run-trail-step-pre" style={{ background: "var(--surface-muted)", padding: "0.5rem 0.75rem", borderRadius: 6, fontWeight: 500 }}>
                          {yourReply}
                        </pre>
                      </div>
                    ) : null;
                  })()}
                  <div>
                    <div className="run-trail-step-field-label" style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
                      What the agent was told (instructions + your reply)
                    </div>
                    <pre className="run-trail-step-pre" style={{ fontSize: "0.85rem", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{formatValue(step.input)}</pre>
                  </div>
                </>
              ) : (
                <>
                  <div className="run-trail-step-field-label">Input</div>
                  <pre className="run-trail-step-pre">{formatValue(step.input)}</pre>
                </>
              )}
            </div>
          )}
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
                    {t.resultSummary != null && (
                      <span style={{ marginLeft: "0.35rem", color: t.resultSummary === "ok" ? "var(--text-muted)" : t.resultSummary === "waiting for user" ? "var(--primary)" : "var(--resource-red)" }}>
                        → {t.resultSummary}
                      </span>
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
              No container command was run in this step. The agent requested your input without calling Run Container or Container session first.
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
          {hasOutput && toolOutputError && (
            <div
              style={{
                marginBottom: "0.75rem",
                padding: "0.75rem 1rem",
                background: "var(--resource-red)",
                color: "var(--bg)",
                borderRadius: 8,
                fontSize: "0.9rem",
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: "0.35rem" }}>Tool error</div>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit", fontSize: "0.85rem" }}>{toolOutputError}</pre>
            </div>
          )}
          {hasOutput && !isContainerLikeOutput(step.output) && (
            <div>
              <div className="run-trail-step-field-label">Output</div>
              <pre className="run-trail-step-pre">{formatValue(step.output)}</pre>
            </div>
          )}
          {isWaitingForUser && runId && (
            <div style={{ padding: "0.5rem 0", color: "var(--text-muted)", fontSize: "0.9rem" }}>
              <a href={`/chat?runId=${encodeURIComponent(runId)}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--primary)", textDecoration: "underline" }}>Reply in Chat</a>
              {" or on this run page to continue."}
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
  const [eventsData, setEventsData] = useState<{
    events: Array<{ sequence: number; type: string; payload: unknown; processedAt: number | null; createdAt: number }>;
    runState: unknown;
    copyForDiagnosis: string;
  } | null>(null);
  const [diagnosisCopied, setDiagnosisCopied] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [submittingReply, setSubmittingReply] = useState(false);
  /** When an option button is clicked, its value while the request is in flight (for loading state). */
  const [submittingOption, setSubmittingOption] = useState<string | null>(null);
  /** Error from last respond attempt (e.g. run no longer waiting); cleared on next load or submit. */
  const [replyError, setReplyError] = useState<string | null>(null);
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
      setReplyError(null);
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

  // When run is waiting_for_user, still poll occasionally so if the user replied from Chat we pick up the update
  useEffect(() => {
    if (run?.status !== "waiting_for_user") return;
    const interval = setInterval(() => void load(true), 500);
    return () => clearInterval(interval);
  }, [run?.status, load]);

  useEffect(() => {
    if (!run?.id || run.targetType !== "workflow") return;
    fetch(`/api/runs/${encodeURIComponent(run.id)}/events`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.events) && data.events.length > 0) {
          setEventsData({ events: data.events, runState: data.runState, copyForDiagnosis: data.copyForDiagnosis ?? "" });
        } else {
          setEventsData(null);
        }
      })
      .catch(() => setEventsData(null));
  }, [run?.id, run?.targetType]);

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

  /** Submit response to the run. Pass a string to send that value (e.g. from an option click); otherwise uses replyText. */
  const handleSubmitReply = useCallback(async (overrideResponse?: string) => {
    if (!id || !run || run.status !== "waiting_for_user") return;
    const text = (overrideResponse != null ? overrideResponse : replyText.trim()) || "(no text)";
    setSubmittingReply(true);
    setReplyError(null);
    if (overrideResponse != null) setSubmittingOption(overrideResponse);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(id)}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: text }),
        credentials: "same-origin",
      });
      if (res.ok) {
        setReplyText("");
        const data = await res.json();
        setRun(data);
        // #region agent log
        const payloadOut = data?.output && typeof data.output === "object" ? (data.output as { output?: { userResponded?: boolean; response?: string } }).output : undefined;
        fetch('http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'runs/[id]/page.tsx:handleSubmitReply',message:'respond ok, applied POST body to run state',data:{userResponded:!!payloadOut?.userResponded,responseLen:typeof payloadOut?.response==='string'?payloadOut.response.length:0},hypothesisId:'reply_ui',timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        await load(true);
      } else {
        const errBody = await res.json().catch(() => ({}));
        const msg = typeof (errBody as { error?: string }).error === "string"
          ? (errBody as { error: string }).error
          : res.status === 400
            ? "Run is no longer waiting for input. The run may have already continued."
            : "Could not send reply.";
        setReplyError(msg);
        await load(true);
      }
    } finally {
      setSubmittingReply(false);
      setSubmittingOption(null);
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
  const waitingForUserMessage = run.status === "waiting_for_user" && out && typeof out === "object" ? getWaitingForUserMessage(out) : "";
  const rawQuestion = run.status === "waiting_for_user" && out && typeof out === "object"
    ? (typeof (out as Record<string, unknown>).question === "string" ? (out as { question: string }).question.trim() : "") || (typeof (out as Record<string, unknown>).message === "string" ? (out as { message: string }).message.trim() : "")
    : "";
  const isVagueRequest = run.status === "waiting_for_user" && rawQuestion !== "" && isVagueWaitingPrompt(rawQuestion);
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
  const payloadOutput = out && typeof out === "object" && (out as { output?: unknown }).output != null ? (out as { output: { userResponded?: boolean; response?: string } }).output : undefined;
  const showUserReplyBanner = run.status === "running" && !!payloadOutput?.userResponded && typeof payloadOutput?.response === "string" && payloadOutput.response !== "";
  const executingMessage =
    run.status === "running" && out && typeof out === "object" && typeof (out as { executing?: string }).executing === "string"
      ? (out as { executing: string }).executing
      : undefined;
  const hasStack = hasError && out && typeof out === "object" && (out.errorDetails as { stack?: string })?.stack;
  const stackTrace = hasStack && out && typeof out === "object" ? (out.errorDetails as { stack: string }).stack : "";
  const shellLogFromTrail = buildShellLog(trail);
  const runLogs = run.logs ?? [];
  const hasLiveLogs = runLogs.length > 0 || run.status === "running";
  // Only stdout/stderr for display; meta entries are used for container status
  const displayLogs = runLogs.filter((e) => e.level !== "meta");
  // Shell & stack trace: prefer persisted run_logs history when available, else trail-derived output
  const hasShellHistory = displayLogs.length > 0 || shellLogFromTrail.trim() !== "";
  const runUsesContainer =
    displayLogs.length > 0 ||
    trail.some((s) => (s.toolCalls ?? []).some((t) => t.name === "std-container-run" || t.name === "std-container-session"));
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
        {(run.status === "failed" || run.status === "waiting_for_user") && (() => {
          const oneLiner = buildWhatWentWrongOneLiner(run.logs ?? []);
          return oneLiner ? (
            <div className="run-detail-section" style={{ paddingBottom: "0.5rem", borderBottom: "1px solid var(--border)" }}>
              <div className="run-detail-label" style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>What went wrong</div>
              <div className="run-detail-value" style={{ fontSize: "0.9rem" }}>{oneLiner}</div>
            </div>
          ) : null;
        })()}
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
        {run.status === "running" && runUsesContainer && (
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
                  ? (executingMessage ? `Running — ${executingMessage}` : "Running — agents are executing.")
                  : run.status === "completed"
                    ? "Completed."
                    : run.status === "failed"
                      ? "Failed."
                      : run.status === "cancelled"
                        ? "Cancelled."
                        : run.status}
            </li>
            {run.targetType === "workflow" && runUsesContainer && (() => {
              const stepWithContainer = trail.find((s) => s.toolCalls?.some((t) => t.name === "std-container-run" || t.name === "std-container-session"));
              const anyToolCalls = trail.some((s) => (s.toolCalls?.length ?? 0) > 0);
              if (stepWithContainer) {
                return (
                  <li>
                    <strong>Container:</strong> Invoked in step #{stepWithContainer.order + 1} — see <strong>Execution trail</strong> (Tools invoked) and <strong>Command output</strong> below.
                  </li>
                );
              }
              if (run.status === "waiting_for_user" && anyToolCalls) {
                return (
                  <li style={{ color: "var(--resource-amber)", fontWeight: 500 }}>
                    <strong>Container:</strong> Not invoked. The agent requested your input without calling Run Container or Container session first. See <strong>Execution trail</strong> → <strong>Tools invoked</strong> for what the agent actually called.
                  </li>
                );
              }
              return (
                <li>
                  <strong>Container:</strong> {anyToolCalls ? "Not invoked in this run." : "No tool calls recorded yet."}
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
            {runUsesContainer && (
              <li style={{ color: "var(--text-muted)", marginTop: "0.25rem" }}>
                <strong>Note:</strong> There is no long-lived container — the agent runs one-off container commands; stdout/stderr appear in <strong>Live container output</strong> below when it does. Send a message in Chat (with this run in context) to interact with the agent.
              </li>
            )}
          </ul>
        </div>
      </div>

      {/* Live container output: only when the workflow actually used a container (std-container-run / std-container-session) */}
      {(run.targetType === "workflow" && runUsesContainer && (hasLiveLogs || run.status === "running" || run.status === "waiting_for_user" || (run.status === "completed" && hasShellHistory))) && (
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
                        <>
                          <span style={{ display: "block", marginTop: "0.75rem", color: "var(--resource-amber)", fontWeight: 500 }}>
                            ▶ Waiting for your input (reply in Chat or on the run page).
                          </span>
                          {waitingForUserMessage && (
                            <span style={{ display: "block", marginTop: "0.35rem", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                              {waitingForUserMessage}
                            </span>
                          )}
                        </>
                      )}
                    </>
                  )
                : shellLogFromTrail.trim() !== "" && (run.status === "waiting_for_user" || run.status === "running" || run.status === "completed")
                  ? (
                      <>
                        <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{shellLogFromTrail}</span>
                        {run.status === "waiting_for_user" && (
                          <>
                            <span style={{ display: "block", marginTop: "0.75rem", color: "var(--resource-amber)", fontWeight: 500 }}>
                              ▶ Waiting for your input (reply in Chat or on the run page).
                            </span>
                            {waitingForUserMessage && (
                              <span style={{ display: "block", marginTop: "0.35rem", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                {waitingForUserMessage}
                              </span>
                            )}
                          </>
                        )}
                      </>
                    )
                  : run.status === "waiting_for_user"
                    ? (isVagueRequest
                        ? `${WAITING_WHAT_TO_DO}\n\nRun is paused. Reply in the box under "Status" on this page, or in Chat.`
                        : waitingForUserMessage
                          ? `${waitingForUserMessage}\n\nRun is paused. No container has been started yet.\n\nAfter you reply in Chat, if the agent runs a container command, stdout and stderr will stream here in real time.`
                          : "Run is paused waiting for your input. No container has been started yet.\n\nAfter you reply in Chat, if the agent runs a container command, stdout and stderr will stream here in real time.")
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
                  ? <>Run is paused; <a href={`/chat?runId=${encodeURIComponent(run.id)}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--primary)", textDecoration: "underline" }}>reply in Chat</a> or on this page to continue.</>
                  : "Run result payload and final output."}
            </p>
          </div>
          <div className="run-detail-output-body">
            <div className="run-detail-output-content">
              {run.status === "waiting_for_user" && !hasError ? (
                <div className="run-detail-value run-detail-reply-box">
                  <div id="run-detail-request" className="run-detail-reply-question">
                    <p style={{ margin: 0, fontWeight: 500, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {waitingForUserMessage || "Waiting for your input."}
                    </p>
                    {isVagueRequest && (
                      <p style={{ margin: "0.35rem 0 0 0", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                        {WAITING_WHAT_TO_DO}
                      </p>
                    )}
                  </div>
                  <div className="run-detail-reply-options-row">
                    {Array.isArray((out as { suggestions?: string[] }).suggestions) && ((out as { suggestions: string[] }).suggestions.length > 0)
                      ? ((out as { suggestions: string[] }).suggestions as string[]).filter((s): s is string => typeof s === "string").map((s, i) => {
                          const sendingThis = submittingOption === s;
                          return (
                            <button
                              key={i}
                              type="button"
                              className="run-detail-reply-option-btn"
                              onClick={() => void handleSubmitReply(s)}
                              disabled={submittingReply}
                              aria-busy={sendingThis}
                              title={sendingThis ? "Sending…" : `Send "${s}"`}
                            >
                              {sendingThis ? (
                                <>
                                  <Loader2 size={14} className="spin" aria-hidden style={{ marginRight: 6, verticalAlign: "middle" }} />
                                  Sending…
                                </>
                              ) : (
                                s
                              )}
                            </button>
                          );
                        })
                      : Array.isArray((out as { options?: string[] }).options) && ((out as { options: string[] }).options.length > 0)
                        ? ((out as { options: string[] }).options as string[]).filter((s): s is string => typeof s === "string").map((s, i) => {
                            const sendingThis = submittingOption === s;
                            return (
                              <button
                                key={i}
                                type="button"
                                className="run-detail-reply-option-btn"
                                onClick={() => void handleSubmitReply(s)}
                                disabled={submittingReply}
                                aria-busy={sendingThis}
                                title={sendingThis ? "Sending…" : `Send "${s}"`}
                              >
                                {sendingThis ? (
                                  <>
                                    <Loader2 size={14} className="spin" aria-hidden style={{ marginRight: 6, verticalAlign: "middle" }} />
                                    Sending…
                                  </>
                                ) : (
                                  s
                                )}
                              </button>
                            );
                          })
                        : null}
                  </div>
                  <form
                    onSubmit={(e) => { e.preventDefault(); void handleSubmitReply(); }}
                    className="run-detail-reply-form"
                  >
                    <textarea
                      id="run-detail-reply-input"
                      className="run-detail-reply-textarea"
                      placeholder="Or type your response…"
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      rows={3}
                      aria-label="Your response"
                      aria-describedby="run-detail-request"
                      disabled={submittingReply}
                    />
                    <button
                      type="submit"
                      className="button button-success run-detail-reply-submit"
                      disabled={submittingReply || !replyText.trim()}
                    >
                      {submittingReply && !submittingOption ? <Loader2 size={14} className="spin" /> : <MessageCircle size={14} />}
                      {submittingReply && !submittingOption ? "Sending…" : "Send"}
                    </button>
                  </form>
                  {replyError && (
                    <p className="run-detail-reply-hint" style={{ color: "var(--resource-red)", marginTop: "0.5rem" }} role="alert">
                      {replyError}
                    </p>
                  )}
                  <p className="run-detail-reply-hint">
                    You can also reply in Chat using &quot;Copy for chat&quot; below.
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
                    <p style={{ margin: 0, color: "var(--text-muted)" }}>Install a container engine (Docker or Podman) to run workflows that use containers:</p>
                    <ul style={{ margin: "0.5rem 0 0 1.25rem", padding: 0 }}>
                      <li><a href="https://docs.docker.com/get-docker/" target="_blank" rel="noopener noreferrer" style={{ color: "var(--primary)" }}>Docker</a></li>
                      <li><a href="https://podman.io/getting-started/installation" target="_blank" rel="noopener noreferrer" style={{ color: "var(--primary)" }}>Podman</a></li>
                    </ul>
                    {isEnoent && (
                      <p style={{ margin: "0.5rem 0 0 0", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                        If your container engine works in your terminal, start the dev server from that same terminal so it inherits the same PATH.
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

      {(trail.length > 0 || (run.status === "running" && run.targetType === "workflow")) && (
        <div id="execution-trail" className="run-detail-card run-detail-trail-card run-detail-grid-card" style={{ scrollMarginTop: "1rem" }}>
          <div className="run-detail-section" style={{ marginBottom: "0.5rem" }}>
            <div className="run-detail-label" style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <GitBranch size={16} /> Execution trail
            </div>
            {showUserReplyBanner && (
              <p style={{ margin: "0.5rem 0 0.75rem 0", padding: "0.5rem 0.75rem", background: "var(--surface-muted)", borderRadius: "var(--radius)", fontSize: "0.9rem", borderLeft: "3px solid var(--primary)" }}>
                <strong>You replied:</strong> <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{payloadOutput?.response ?? ""}</span>
              </p>
            )}
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0.25rem 0 0 0" }}>
              Full history in order: <strong>oldest at top, newest at bottom.</strong> Tool calls, your replies, and results appear in the order they happened. Expand a step below to see details. When an agent runs a container command, its <strong>Command output</strong> appears here and in <strong>Shell &amp; stack trace</strong> below.
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
            {trail.length > 0 && (() => {
              const sorted = trail.slice().sort((a, b) => a.order - b.order);
              type TrailEvent = { kind: "tool"; stepNum: number; name: string; argsSummary?: string; resultSummary?: string } | { kind: "user_reply"; stepNum: number; reply: string };
              const events: TrailEvent[] = [];
              for (const s of sorted) {
                if (s.inputIsUserReply && s.input != null) {
                  const reply = extractUserReplyFromPartnerMessage(s.input);
                  if (reply != null) events.push({ kind: "user_reply", stepNum: s.order + 1, reply });
                }
                for (const t of s.toolCalls ?? []) {
                  events.push({ kind: "tool", stepNum: s.order + 1, name: t.name, argsSummary: t.argsSummary, resultSummary: t.resultSummary });
                }
              }
              if (events.length === 0) return null;
              return (
                <div style={{ marginTop: "0.75rem", padding: "0.6rem 0.75rem", background: "var(--surface-muted)", borderRadius: "var(--radius)", fontSize: "0.85rem" }}>
                  <div style={{ fontWeight: 600, marginBottom: "0.2rem" }}>What happened (chronological)</div>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.35rem" }}>Oldest at top → newest at bottom. Each line is one action or your reply, with its result.</div>
                  <div style={{ maxHeight: "min(40vh, 320px)", overflowY: "auto", overflowX: "hidden" }}>
                    <ol style={{ margin: 0, paddingLeft: "1.25rem", lineHeight: 1.6 }}>
                      {events.map((e, i) =>
                        e.kind === "user_reply" ? (
                          <li key={i}>
                            <span style={{ color: "var(--primary)", fontWeight: 500 }}>You replied:</span> {e.reply}
                          </li>
                        ) : (
                          <li key={i}>
                            <span style={{ color: "var(--text-muted)", marginRight: "0.35rem" }}>#{e.stepNum}</span>
                            <code style={{ fontSize: "0.8em" }}>{e.name}</code>
                            {e.argsSummary != null && <span style={{ color: "var(--text-muted)" }}> {e.argsSummary}</span>}
                            {e.resultSummary != null && (
                              <span style={{ color: e.resultSummary === "ok" ? "var(--text-muted)" : e.resultSummary === "waiting for user" ? "var(--primary)" : "var(--resource-red)" }}> → {e.resultSummary}</span>
                            )}
                          </li>
                        )
                      )}
                    </ol>
                  </div>
                </div>
              );
            })()}
          </div>
          <div
            className="run-detail-trail-list"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
              maxHeight: "min(70vh, 640px)",
              overflowY: "auto",
              overflowX: "hidden",
            }}
          >
            {trail.length > 0 && (
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0 0 0.25rem 0", flexShrink: 0 }}>
                Step details (same order: oldest first)
              </p>
            )}
            {trail.length === 0 && run.status === "running" ? (
              <div className="run-trail-step run-trail-step-progress" style={{ padding: "0.75rem 1rem", background: "var(--surface-muted)", borderRadius: "var(--radius)", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.9rem" }}>
                <Loader2 size={18} className="spin" style={{ flexShrink: 0 }} />
                <span>{executingMessage ?? "Workflow is running…"}</span>
              </div>
            ) : (
              trail
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((step, i) => (
                  <TrailStepCard
                    key={`${step.nodeId}-${step.order}-${i}`}
                    step={step}
                    index={i}
                    outputsOnly={showOutputsOnly}
                    runId={run?.id}
                  />
                ))
            )}
          </div>
        </div>
      )}

      {out != null && typeof out === "object" && (runUsesContainer || stackTrace) && (
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

      {eventsData && eventsData.events.length > 0 && (
        <div className="run-detail-card run-detail-grid-card" style={{ scrollMarginTop: "1rem" }}>
          <div className="run-detail-section">
            <div className="run-detail-label" style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <ListOrdered size={16} /> Event queue (diagnosis)
            </div>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0.25rem 0 0.5rem 0" }}>
              Execution events for this run. Copy for support or debugging.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <button
                type="button"
                className="button secondary"
                style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
                onClick={async () => {
                  if (eventsData?.copyForDiagnosis && (await copyToClipboard(eventsData.copyForDiagnosis))) {
                    setDiagnosisCopied(true);
                    setTimeout(() => setDiagnosisCopied(false), 2000);
                  }
                }}
              >
                {diagnosisCopied ? <CheckCircle size={14} /> : <Copy size={14} />}
                {diagnosisCopied ? "Copied" : "Copy for diagnosis"}
              </button>
            </div>
            <div style={{ maxHeight: "min(40vh, 280px)", overflowY: "auto", overflowX: "auto", fontSize: "0.8rem", background: "var(--surface-muted)", borderRadius: "var(--radius)", padding: "0.5rem 0.75rem" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                    <th style={{ padding: "0.25rem 0.5rem 0.25rem 0" }}>#</th>
                    <th style={{ padding: "0.25rem 0.5rem" }}>Type</th>
                    <th style={{ padding: "0.25rem 0.5rem" }}>Processed</th>
                  </tr>
                </thead>
                <tbody>
                  {eventsData.events.map((ev) => (
                    <tr key={ev.sequence} style={{ borderBottom: "1px solid var(--border-muted)" }}>
                      <td style={{ padding: "0.25rem 0.5rem 0.25rem 0" }}>{ev.sequence}</td>
                      <td style={{ padding: "0.25rem 0.5rem" }}><code>{ev.type}</code></td>
                      <td style={{ padding: "0.25rem 0.5rem", color: "var(--text-muted)" }}>{ev.processedAt != null ? new Date(ev.processedAt).toLocaleString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

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
