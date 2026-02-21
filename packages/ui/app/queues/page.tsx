"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, RefreshCw, MessageSquare, GitBranch, History, ChevronDown, ChevronRight, Copy, Check } from "lucide-react";

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

type ChatTraceEntry = {
  conversationId: string;
  messageId: string;
  createdAt: number;
  toolCalls: Array<{ name: string; args?: Record<string, unknown>; result?: unknown }>;
  llmTrace: Array<{ phase?: string; messageCount?: number; responsePreview?: string; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } }>;
};

type MessageQueueLogEntry = {
  id: string;
  type: string;
  phase: string | null;
  label: string | null;
  payload: string | null;
  createdAt: number;
};

type QueuesData = {
  workflowQueue: {
    status: { queued: number; running: number; concurrency: number };
    jobs: WorkflowQueueJob[];
  };
  conversationLocks: Array<{ conversationId: string; startedAt: number; createdAt: number }>;
  activeChatTraces?: ChatTraceEntry[];
  messageQueueLog?: Array<{ conversationId: string; steps: MessageQueueLogEntry[] }>;
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

const POLL_INTERVAL_MS = 2500;
const HISTORY_PAGE_SIZE = 50;
const STEPS_PAGE_SIZE = 50;

function stepToCopyLines(s: MessageQueueLogEntry, formatTs: (ts: number) => string): string[] {
  const label = s.label ?? s.type;
  const lines: string[] = [`${formatTs(s.createdAt)}\t${s.phase ?? ""}\t${label}`];
  if (s.payload) {
    try {
      const obj = JSON.parse(s.payload) as Record<string, unknown>;
      const requestMessages = Array.isArray(obj.requestMessages)
        ? obj.requestMessages as Array<{ role?: string; content?: string }>
        : null;
      const responseContent = typeof obj.responseContent === "string" ? obj.responseContent : null;
      if (s.phase === "llm_request" && requestMessages && requestMessages.length > 0) {
        lines.push("  --- Full prompt (messages sent to LLM) ---");
        for (const m of requestMessages) {
          const role = (m.role ?? "unknown").toUpperCase();
          const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
          lines.push(`  [${role}]`, content.split("\n").map((l) => `    ${l}`).join("\n"), "");
        }
      } else if (s.phase === "llm_response" && responseContent !== null) {
        lines.push("  --- Full LLM output ---", responseContent.split("\n").map((l) => `  ${l}`).join("\n"));
      } else if (obj.rephrasedPrompt && typeof obj.rephrasedPrompt === "string") {
        lines.push(`  Rephrased: ${obj.rephrasedPrompt}`);
      } else if (s.phase === "planner_request") {
        const prompt = obj.plannerPrompt != null ? String(obj.plannerPrompt) : "";
        lines.push("  --- Planner input (user message + specialist list + options) ---");
        lines.push(prompt.split("\n").map((l) => `  ${l}`).join("\n"));
      } else if (s.phase === "planner_response") {
        if (obj.parsedPlan != null) {
          lines.push("  --- Derived plan ---");
          lines.push(JSON.stringify(obj.parsedPlan, null, 2).split("\n").map((l) => `  ${l}`).join("\n"));
        }
        if (obj.noPlanReason != null && typeof obj.noPlanReason === "string") {
          lines.push("  --- No plan reason ---");
          lines.push(`  ${obj.noPlanReason}`);
        }
        if (obj.extractedTextForParsing != null && typeof obj.extractedTextForParsing === "string") {
          lines.push("  --- Text used for parsing ---");
          lines.push(obj.extractedTextForParsing.split("\n").map((l) => `  ${l}`).join("\n"));
        }
        const raw = obj.rawResponse != null ? String(obj.rawResponse) : "";
        lines.push("  --- Planner raw LLM output ---");
        lines.push(raw.split("\n").map((l) => `  ${l}`).join("\n"));
        if (obj.rawPreview != null && typeof obj.rawPreview === "string") {
          lines.push("  --- Provider raw preview ---");
          lines.push(obj.rawPreview.split("\n").map((l) => `  ${l}`).join("\n"));
        }
      } else if (s.phase === "heap_tool" || s.phase === "heap_tool_done") {
        if (obj.toolInput != null) lines.push("  toolInput:", JSON.stringify(obj.toolInput, null, 2).split("\n").map((l) => `  ${l}`).join("\n"));
        if (obj.toolOutput != null) lines.push("  toolOutput:", JSON.stringify(obj.toolOutput, null, 2).split("\n").map((l) => `  ${l}`).join("\n"));
      } else if (s.phase === "heap_route") {
        const task = typeof obj.refinedTask === "string" ? obj.refinedTask : "";
        const order = Array.isArray(obj.priorityOrder) ? JSON.stringify(obj.priorityOrder) : "";
        lines.push([task && `Task: ${task}`, order && `Order: ${order}`].filter(Boolean).join(" | "));
        if (obj.extractedContext && typeof obj.extractedContext === "object") {
          lines.push("  Extracted context:", JSON.stringify(obj.extractedContext, null, 2).split("\n").map((l) => `  ${l}`).join("\n"));
        }
        ["instructionsForGeneral", "instructionsForAgent", "instructionsForWorkflow", "instructionsForImproveRun", "instructionsForImproveHeap", "instructionsForImproveAgentsWorkflows", "instructionsForImprovement", "instructionsForImprovementSession", "instructionsForImprovementHeap"].forEach((key) => {
          const v = obj[key];
          if (typeof v === "string" && v.trim()) lines.push(`  ${key}: ${v}`);
        });
      } else if (s.type === "error") {
        const code = typeof obj.errorCode === "string" ? obj.errorCode : "";
        const msg = typeof obj.error === "string" ? obj.error : "";
        lines.push([code && `Code: ${code}`, msg && `Message: ${msg}`].filter(Boolean).join(" | "));
      } else {
        const preview = obj.inputPreview && typeof obj.inputPreview === "string"
          ? `In: ${obj.inputPreview}`
          : obj.contentPreview && typeof obj.contentPreview === "string"
            ? `Out: ${obj.contentPreview}`
            : s.payload.length > 500 ? `${s.payload.slice(0, 500)}…` : s.payload;
        lines.push(`  ${preview}`);
      }
    } catch {
      lines.push(`  ${s.payload.length > 300 ? s.payload.slice(0, 300) + "…" : s.payload}`);
    }
  }
  return lines;
}

const detailBlockStyle = {
  marginLeft: "5.25rem",
  fontSize: "0.8rem",
  color: "var(--text-muted)",
  whiteSpace: "pre-wrap" as const,
  wordBreak: "break-word" as const,
  maxHeight: 120,
  overflow: "auto" as const,
};

const fullLlmBlockStyle = {
  ...detailBlockStyle,
  maxHeight: 360,
  border: "1px solid var(--border)",
  borderRadius: 4,
  padding: "0.5rem",
  marginTop: "0.25rem",
} as const;

function renderQueueLogStep(s: MessageQueueLogEntry, formatTs: (ts: number) => string) {
  let payloadObj: Record<string, unknown> | undefined;
  if (s.payload) {
    try {
      payloadObj = JSON.parse(s.payload) as Record<string, unknown>;
    } catch {
      payloadObj = undefined;
    }
  }
  const rephrasedPrompt =
    s.type === "rephrased_prompt" && payloadObj && typeof payloadObj.rephrasedPrompt === "string"
      ? payloadObj.rephrasedPrompt
      : null;
  const requestMessages = payloadObj && Array.isArray(payloadObj.requestMessages)
    ? payloadObj.requestMessages as Array<{ role?: string; content?: string }>
    : null;
  const responseContent = payloadObj && typeof payloadObj.responseContent === "string" ? payloadObj.responseContent : null;
  const llmInputPreview = payloadObj && typeof payloadObj.inputPreview === "string" ? payloadObj.inputPreview : null;
  const llmOutputPreview = payloadObj && typeof payloadObj.contentPreview === "string" ? payloadObj.contentPreview : null;
  const showFullLlmRequest = s.phase === "llm_request" && requestMessages && requestMessages.length > 0;
  const showFullLlmResponse = s.phase === "llm_response" && responseContent !== null;
  const showLlmPreview = !showFullLlmRequest && !showFullLlmResponse && ((s.phase === "llm_request" && llmInputPreview) || (s.phase === "llm_response" && llmOutputPreview));
  const plannerPrompt = s.phase === "planner_request" && payloadObj && payloadObj.plannerPrompt != null ? String(payloadObj.plannerPrompt) : null;
  const plannerRawResponse = s.phase === "planner_response" && payloadObj && payloadObj.rawResponse != null ? String(payloadObj.rawResponse) : null;
  const plannerParsedPlan = s.phase === "planner_response" && payloadObj && payloadObj.parsedPlan != null ? payloadObj.parsedPlan : null;
  const plannerNoPlanReason = s.phase === "planner_response" && payloadObj && typeof payloadObj.noPlanReason === "string" ? payloadObj.noPlanReason : null;
  const plannerExtractedText = s.phase === "planner_response" && payloadObj && typeof payloadObj.extractedTextForParsing === "string" ? payloadObj.extractedTextForParsing : null;
  const heapToolInput = (s.phase === "heap_tool" || s.phase === "heap_tool_done") && payloadObj && payloadObj.toolInput !== undefined ? payloadObj.toolInput : null;
  const heapToolOutput = (s.phase === "heap_tool" || s.phase === "heap_tool_done") && payloadObj && payloadObj.toolOutput !== undefined ? payloadObj.toolOutput : null;
  const heapRouteRefinedTask = s.phase === "heap_route" && payloadObj && typeof payloadObj.refinedTask === "string" ? payloadObj.refinedTask : null;
  const heapRouteOrder = s.phase === "heap_route" && payloadObj && Array.isArray(payloadObj.priorityOrder) ? payloadObj.priorityOrder : null;
  const heapRouteExtractedContext = s.phase === "heap_route" && payloadObj && payloadObj.extractedContext && typeof payloadObj.extractedContext === "object" ? payloadObj.extractedContext as Record<string, unknown> : null;
  const heapRouteInstructions = s.phase === "heap_route" && payloadObj
    ? [
        payloadObj.instructionsForGeneral != null && typeof payloadObj.instructionsForGeneral === "string" ? { id: "general", text: payloadObj.instructionsForGeneral } : null,
        payloadObj.instructionsForAgent != null && typeof payloadObj.instructionsForAgent === "string" ? { id: "agent", text: payloadObj.instructionsForAgent } : null,
        payloadObj.instructionsForWorkflow != null && typeof payloadObj.instructionsForWorkflow === "string" ? { id: "workflow", text: payloadObj.instructionsForWorkflow } : null,
        payloadObj.instructionsForImproveRun != null && typeof payloadObj.instructionsForImproveRun === "string" ? { id: "improve_run", text: payloadObj.instructionsForImproveRun } : null,
        payloadObj.instructionsForImproveHeap != null && typeof payloadObj.instructionsForImproveHeap === "string" ? { id: "improve_heap", text: payloadObj.instructionsForImproveHeap } : null,
        payloadObj.instructionsForImproveAgentsWorkflows != null && typeof payloadObj.instructionsForImproveAgentsWorkflows === "string" ? { id: "improve_agents_workflows", text: payloadObj.instructionsForImproveAgentsWorkflows } : null,
        payloadObj.instructionsForImprovement != null && typeof payloadObj.instructionsForImprovement === "string" ? { id: "improvement", text: payloadObj.instructionsForImprovement } : null,
        payloadObj.instructionsForImprovementSession != null && typeof payloadObj.instructionsForImprovementSession === "string" ? { id: "improvement_session", text: payloadObj.instructionsForImprovementSession } : null,
        payloadObj.instructionsForImprovementHeap != null && typeof payloadObj.instructionsForImprovementHeap === "string" ? { id: "improvement_heap", text: payloadObj.instructionsForImprovementHeap } : null,
      ].filter((x): x is { id: string; text: string } => x != null)
    : [];
  const userInputPreview = s.phase === "user_input" && payloadObj && typeof payloadObj.inputPreview === "string" ? payloadObj.inputPreview : null;
  const errorMsg = s.type === "error" && payloadObj && typeof payloadObj.error === "string" ? payloadObj.error : null;
  const errorCode = s.type === "error" && payloadObj && typeof payloadObj.errorCode === "string" ? payloadObj.errorCode : null;
  return (
    <li key={s.id} style={{ padding: "0.2rem 0", display: "flex", flexDirection: "column", gap: "0.15rem", flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        <span style={{ color: "var(--text-muted)", minWidth: "4.5rem" }}>{formatTs(s.createdAt)}</span>
        <span style={{ fontWeight: s.type === "done" ? 600 : undefined }}>{s.label ?? s.type}</span>
        {s.phase && s.phase !== s.label && (
          <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>({s.phase})</span>
        )}
        {payloadObj && typeof payloadObj.specialistId === "string" && (
          <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>{payloadObj.specialistId}</span>
        )}
      </div>
      {rephrasedPrompt != null && <div style={detailBlockStyle}>{rephrasedPrompt}</div>}
      {showFullLlmRequest && (
        <div style={fullLlmBlockStyle}>
          <strong>Full prompt (messages sent to LLM)</strong>
          {requestMessages!.map((m, i) => (
            <div key={i} style={{ marginTop: i > 0 ? "0.5rem" : "0.25rem" }}>
              <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>[{(m.role ?? "unknown").toUpperCase()}]</span>
              <div style={{ marginLeft: "0.5rem" }}>{typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "")}</div>
            </div>
          ))}
        </div>
      )}
      {showFullLlmResponse && (
        <div style={fullLlmBlockStyle}>
          <strong>Full LLM output</strong>
          <div style={{ marginTop: "0.25rem" }}>{responseContent}</div>
        </div>
      )}
      {showLlmPreview && (
        <div style={detailBlockStyle}>
          {llmInputPreview != null && <div><strong>In:</strong> {llmInputPreview}</div>}
          {llmOutputPreview != null && <div><strong>Out:</strong> {llmOutputPreview}</div>}
        </div>
      )}
      {plannerPrompt != null && (
        <div style={fullLlmBlockStyle}>
          <strong>Planner input (user message + specialists + options)</strong>
          <pre style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{plannerPrompt}</pre>
        </div>
      )}
      {(plannerRawResponse != null || plannerParsedPlan != null || plannerNoPlanReason != null || plannerExtractedText != null) && (
        <div style={fullLlmBlockStyle}>
          {(plannerParsedPlan != null || plannerNoPlanReason != null) && (
            <div style={{ marginBottom: "0.5rem" }}>
              <strong>Derived plan</strong>
              {plannerParsedPlan != null ? (
                <pre style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{JSON.stringify(plannerParsedPlan, null, 2)}</pre>
              ) : (
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "var(--text-muted)" }}>{plannerNoPlanReason ?? "No plan could be derived."}</p>
              )}
            </div>
          )}
          {plannerExtractedText != null && (
            <div style={{ marginBottom: "0.5rem" }}>
              <strong>Text used for parsing</strong>
              <pre style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{plannerExtractedText}</pre>
            </div>
          )}
          {plannerRawResponse != null && (
            <>
              <strong>Planner raw output</strong>
              <pre style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {plannerRawResponse.trim() ? plannerRawResponse : "(No raw output captured)"}
              </pre>
            </>
          )}
        </div>
      )}
      {(heapToolInput !== null || heapToolOutput !== null) && (
        <div style={detailBlockStyle}>
          {heapToolInput !== null && (
            <div style={{ marginBottom: "0.25rem" }}>
              <strong>Tool input:</strong>
              <pre style={{ margin: "0.15rem 0 0", fontSize: "0.75rem", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 200, overflow: "auto" }}>{typeof heapToolInput === "string" ? heapToolInput : JSON.stringify(heapToolInput, null, 2)}</pre>
            </div>
          )}
          {heapToolOutput !== null && (
            <div>
              <strong>Tool output:</strong>
              <pre style={{ margin: "0.15rem 0 0", fontSize: "0.75rem", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 200, overflow: "auto" }}>{typeof heapToolOutput === "string" ? heapToolOutput : JSON.stringify(heapToolOutput, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
      {s.phase === "heap_route" && (heapRouteRefinedTask != null || heapRouteOrder != null || heapRouteExtractedContext != null || heapRouteInstructions.length > 0) && (
        <div style={detailBlockStyle}>
          {heapRouteRefinedTask != null && <div><strong>Task:</strong> {heapRouteRefinedTask}</div>}
          {heapRouteOrder != null && <div><strong>Order:</strong> {JSON.stringify(heapRouteOrder)}</div>}
          {heapRouteExtractedContext != null && Object.keys(heapRouteExtractedContext).length > 0 && (
            <div style={{ marginTop: "0.25rem" }}>
              <strong>Extracted context:</strong>
              <pre style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {JSON.stringify(heapRouteExtractedContext, null, 2)}
              </pre>
            </div>
          )}
          {heapRouteInstructions.length > 0 && (
            <div style={{ marginTop: "0.25rem" }}>
              <strong>Plan instructions:</strong>
              {heapRouteInstructions.map(({ id, text }) => (
                <div key={id} style={{ marginTop: "0.2rem" }}>
                  <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>{id}:</span> {text}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {userInputPreview != null && (
        <div style={detailBlockStyle}>
          <strong>In:</strong> {userInputPreview}
        </div>
      )}
      {(errorMsg != null || errorCode != null) && (
        <div style={{ ...detailBlockStyle, borderLeftColor: "var(--error-border, #dc2626)" }}>
          {errorCode != null && <div><strong>Code:</strong> <code>{errorCode}</code></div>}
          {errorMsg != null && <div><strong>Message:</strong> {errorMsg}</div>}
        </div>
      )}
    </li>
  );
}

export default function QueuesPage() {
  const searchParams = useSearchParams();
  const convFromUrl = searchParams.get("conversation")?.trim() || null;
  const [data, setData] = useState<QueuesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [historyConversations, setHistoryConversations] = useState<Array<{ conversationId: string; lastAt: number; stepCount: number }>>([]);
  const [historyNextOffset, setHistoryNextOffset] = useState<number | null>(null);
  const [historyLoadingConvs, setHistoryLoadingConvs] = useState(false);
  const [selectedHistoryConvId, setSelectedHistoryConvId] = useState<string | null>(null);
  const [historySteps, setHistorySteps] = useState<MessageQueueLogEntry[]>([]);
  const [historyStepsNextCursor, setHistoryStepsNextCursor] = useState<string | null>(null);
  const [historyStepsLoading, setHistoryStepsLoading] = useState(false);
  const [historySectionOpen, setHistorySectionOpen] = useState(!!convFromUrl);
  const [copiedSection, setCopiedSection] = useState<"workflow" | "active" | "history" | null>(null);

  const copyToClipboard = useCallback((text: string, section: "workflow" | "active" | "history") => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedSection(section);
      setTimeout(() => setCopiedSection(null), 2000);
    });
  }, []);

  const loadHistoryConversations = useCallback(async (offset: number) => {
    setHistoryLoadingConvs(true);
    try {
      const res = await fetch(`/api/queues/message-log?limit=${HISTORY_PAGE_SIZE}&offset=${offset}`, { cache: "no-store" });
      const json = await res.json();
      if (res.ok && Array.isArray(json.conversations)) {
        if (offset === 0) setHistoryConversations(json.conversations);
        else setHistoryConversations((prev) => [...prev, ...json.conversations]);
        setHistoryNextOffset(json.nextOffset ?? null);
      }
    } finally {
      setHistoryLoadingConvs(false);
    }
  }, []);

  const loadHistorySteps = useCallback(async (convId: string, cursor?: string | null) => {
    setHistoryStepsLoading(true);
    try {
      const url = cursor
        ? `/api/queues/message-log?conversationId=${encodeURIComponent(convId)}&limit=${STEPS_PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`
        : `/api/queues/message-log?conversationId=${encodeURIComponent(convId)}&limit=${STEPS_PAGE_SIZE}`;
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();
      if (res.ok && Array.isArray(json.steps)) {
        if (!cursor) setHistorySteps(json.steps);
        else setHistorySteps((prev) => [...prev, ...json.steps]);
        setHistoryStepsNextCursor(json.nextCursor ?? null);
      }
    } finally {
      setHistoryStepsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (convFromUrl && convFromUrl !== selectedHistoryConvId) {
      setSelectedHistoryConvId(convFromUrl);
      setHistorySteps([]);
      setHistoryStepsNextCursor(null);
    }
  }, [convFromUrl]);

  useEffect(() => {
    if (selectedHistoryConvId != null && historySteps.length === 0 && historyStepsNextCursor === null && !historyStepsLoading) {
      loadHistorySteps(selectedHistoryConvId);
    }
  }, [selectedHistoryConvId, historySteps.length, historyStepsNextCursor, historyStepsLoading, loadHistorySteps]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/queues", { cache: "no-store" });
      const json = await res.json();
      if (res.ok) {
        setData(json);
      } else {
        const msg = typeof json?.error === "string" ? json.error : "Failed to load queues";
        setLoadError(msg);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load queues";
      setLoadError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const tick = () => void load();
    let interval: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => {
      if (interval == null) interval = setInterval(tick, POLL_INTERVAL_MS);
    };
    const stopPolling = () => {
      if (interval != null) {
        clearInterval(interval);
        interval = null;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        tick();
        startPolling();
      } else {
        stopPolling();
      }
    };
    if (document.visibilityState === "visible") {
      startPolling();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopPolling();
    };
  }, [load]);

  const formatTs = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay ? d.toLocaleTimeString() : d.toLocaleString();
  };

  useEffect(() => {
    if (historySectionOpen && historyConversations.length === 0 && !historyLoadingConvs) {
      loadHistoryConversations(0);
    }
  }, [historySectionOpen, historyConversations.length, historyLoadingConvs, loadHistoryConversations]);

  if (loading && !data) {
    return (
      <div className="page-content">
        <div className="loading-placeholder">Loading queues…</div>
      </div>
    );
  }

  const wq = data?.workflowQueue ?? { status: { queued: 0, running: 0, concurrency: 2 }, jobs: [] };
  const locks = data?.conversationLocks ?? [];
  const activeChatTraces = data?.activeChatTraces ?? [];
  const messageQueueLog = data?.messageQueueLog ?? [];
  const traceByConversation = new Map(activeChatTraces.map((t) => [t.conversationId, t]));
  const stepsByConversation = new Map(messageQueueLog.map((e) => [e.conversationId, e.steps]));

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
        {loadError ? (
          <p style={{ marginTop: "0.5rem", color: "var(--text-error, #c00)", fontSize: "0.9rem" }}>{loadError}</p>
        ) : null}
      </div>

      <section style={{ marginBottom: "2rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
          <h2 style={{ fontSize: "1.1rem", margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <GitBranch size={18} />
            Workflow queue
          </h2>
          <button
            type="button"
            className="button button-secondary"
            style={{ fontSize: "0.8rem", display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
            onClick={() => {
              const lines = [
                "Workflow queue",
                `Queued: ${wq.status.queued} · Running: ${wq.status.running} · Concurrency: ${wq.status.concurrency}`,
                "",
                ...wq.jobs.map((j) =>
                  [j.status, j.type, j.runId ?? j.payload.slice(0, 60), formatTs(j.enqueuedAt), j.finishedAt != null ? formatTs(j.finishedAt) : "", j.error ?? ""].join("\t")
                ),
                "",
                "--- JSON ---",
                JSON.stringify({ workflowQueue: data?.workflowQueue ?? wq }, null, 2),
              ];
              copyToClipboard(lines.join("\n"), "workflow");
            }}
            title="Copy workflow queue (readable + JSON)"
          >
            {copiedSection === "workflow" ? <Check size={14} /> : <Copy size={14} />}
            {copiedSection === "workflow" ? "Copied" : "Copy"}
          </button>
        </div>
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
          <h2 style={{ fontSize: "1.1rem", margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <MessageSquare size={18} />
            Active chat turns (conversation locks)
          </h2>
          <button
            type="button"
            className="button button-secondary"
            style={{ fontSize: "0.8rem", display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
            onClick={() => {
              const lines: string[] = ["Active chat turns (conversation locks)", ""];
              for (const lock of locks) {
                const steps = stepsByConversation.get(lock.conversationId) ?? [];
                const trace = traceByConversation.get(lock.conversationId);
                lines.push(`Conversation ${lock.conversationId}`);
                lines.push(`  started ${formatTs(lock.startedAt)}`);
                if (steps.length > 0) {
                  lines.push("  Message queue steps:");
                  for (const s of steps) lines.push(...stepToCopyLines(s, formatTs).map((l) => "    " + l));
                }
                if (trace && (trace.toolCalls.length > 0 || trace.llmTrace.length > 0)) {
                  if (trace.toolCalls.length > 0) lines.push(`  Tools: ${trace.toolCalls.map((t) => t.name).join(", ")}`);
                  if (trace.llmTrace.length > 0) lines.push(`  LLM calls: ${trace.llmTrace.length}`);
                }
                lines.push("");
              }
              lines.push("--- JSON ---", JSON.stringify({ conversationLocks: data?.conversationLocks ?? locks, activeChatTraces: data?.activeChatTraces ?? [], messageQueueLog: data?.messageQueueLog ?? [] }, null, 2));
              copyToClipboard(lines.join("\n"), "active");
            }}
            title="Copy active chat turns (readable + JSON)"
          >
            {copiedSection === "active" ? <Check size={14} /> : <Copy size={14} />}
            {copiedSection === "active" ? "Copied" : "Copy"}
          </button>
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "0.75rem" }}>
          One turn at a time per conversation; these rows show which conversations are currently processing.
        </p>
        {locks.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>No active chat turns.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {locks.map((lock) => {
              const trace = traceByConversation.get(lock.conversationId);
              const steps = stepsByConversation.get(lock.conversationId) ?? [];
              return (
                <li
                  key={lock.conversationId}
                  style={{
                    padding: "0.5rem 0.75rem",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    marginBottom: "0.5rem",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                    <Loader2 size={14} className="spin" />
                    <Link href={`/chat?conversation=${encodeURIComponent(lock.conversationId)}`} style={{ color: "var(--link)" }}>
                      {lock.conversationId.slice(0, 8)}…
                    </Link>
                    <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>started {formatTs(lock.startedAt)}</span>
                  </div>
                  {steps.length > 0 && (
                    <div style={{ marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid var(--border)", fontSize: "0.85rem" }}>
                      <div style={{ color: "var(--text-muted)", marginBottom: "0.25rem" }}>Message queue steps:</div>
                      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                        {steps.map((s) => renderQueueLogStep(s, formatTs))}
                      </ul>
                    </div>
                  )}
                  {trace && (trace.toolCalls.length > 0 || trace.llmTrace.length > 0) && (
                    <div style={{ marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid var(--border)", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                      {trace.toolCalls.length > 0 && (
                        <span style={{ marginRight: "1rem" }}>
                          Tools: {trace.toolCalls.map((t) => t.name).join(", ")}
                        </span>
                      )}
                      {trace.llmTrace.length > 0 && (
                        <span>LLM calls: {trace.llmTrace.length}</span>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2
          style={{
            fontSize: "1.1rem",
            marginBottom: "0.75rem",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            cursor: "pointer",
            userSelect: "none",
          }}
          onClick={() => setHistorySectionOpen((o) => !o)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setHistorySectionOpen((o) => !o); } }}
          aria-expanded={historySectionOpen}
        >
          {historySectionOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          <History size={18} />
          Message queue history (all chats)
        </h2>
        {historySectionOpen && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", margin: 0 }}>
                Browse queue log by conversation. Scroll the list and use &quot;Load more conversations&quot; to see more.
              </p>
              {!selectedHistoryConvId && historyConversations.length > 0 && (
                <button
                  type="button"
                  className="button button-secondary"
                  style={{ fontSize: "0.8rem", display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
                  onClick={() => {
                    const lines = ["Message queue history (conversations)", ""];
                    for (const c of historyConversations) {
                      lines.push(`${c.conversationId}\t${formatTs(c.lastAt)}\t${c.stepCount} step${c.stepCount !== 1 ? "s" : ""}`);
                    }
                    lines.push("", "--- JSON ---", JSON.stringify(historyConversations, null, 2));
                    copyToClipboard(lines.join("\n"), "history");
                  }}
                  title="Copy conversation list (loaded queues)"
                >
                  {copiedSection === "history" ? <Check size={14} /> : <Copy size={14} />}
                  {copiedSection === "history" ? "Copied" : "Copy list"}
                </button>
              )}
            </div>
            {selectedHistoryConvId ? (
              <div style={{ marginBottom: "0.75rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
                  <span style={{ fontWeight: 600 }}>Steps for {selectedHistoryConvId.slice(0, 8)}…</span>
                  <Link href={`/chat?conversation=${encodeURIComponent(selectedHistoryConvId)}`} style={{ fontSize: "0.9rem", color: "var(--link)" }}>
                    Open in Chat
                  </Link>
                  <button
                    type="button"
                    className="button button-secondary"
                    style={{ fontSize: "0.85rem" }}
                    onClick={() => { setSelectedHistoryConvId(null); setHistorySteps([]); setHistoryStepsNextCursor(null); }}
                  >
                    Back to list
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    style={{ fontSize: "0.85rem", display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
                    onClick={() => {
                      const lines = [`Message queue steps: ${selectedHistoryConvId}`, ""];
                      for (const s of historySteps) lines.push(...stepToCopyLines(s, formatTs));
                      lines.push("", "--- JSON ---", JSON.stringify({ conversationId: selectedHistoryConvId, steps: historySteps }, null, 2));
                      copyToClipboard(lines.join("\n"), "history");
                    }}
                    title="Copy steps for this queue"
                  >
                    {copiedSection === "history" ? <Check size={14} /> : <Copy size={14} />}
                    {copiedSection === "history" ? "Copied" : "Copy steps"}
                  </button>
                </div>
                <ul style={{ listStyle: "none", margin: 0, fontSize: "0.85rem", border: "1px solid var(--border)", borderRadius: 6, padding: "0.5rem", maxHeight: 400, overflowY: "auto" }}>
                  {historySteps.map((s) => renderQueueLogStep(s, formatTs))}
                </ul>
                {historyStepsLoading && <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginTop: "0.5rem" }}>Loading…</p>}
                {historyStepsNextCursor && !historyStepsLoading && (
                  <button
                    type="button"
                    className="button button-secondary"
                    style={{ marginTop: "0.5rem" }}
                    onClick={() => loadHistorySteps(selectedHistoryConvId, historyStepsNextCursor)}
                  >
                    Load more steps
                  </button>
                )}
              </div>
            ) : (
              <>
                {historyLoadingConvs && historyConversations.length === 0 && (
                  <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Loading conversations…</p>
                )}
                {historyConversations.length > 0 && (
                  <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                    {historyConversations.map((c) => (
                      <li
                        key={c.conversationId}
                        style={{
                          padding: "0.5rem 0.75rem",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          marginBottom: "0.5rem",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          flexWrap: "wrap",
                          gap: "0.5rem",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                          <Link href={`/chat?conversation=${encodeURIComponent(c.conversationId)}`} style={{ color: "var(--link)" }}>
                            {c.conversationId.slice(0, 8)}…
                          </Link>
                          <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                            {formatTs(c.lastAt)} · {c.stepCount} step{c.stepCount !== 1 ? "s" : ""}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="button button-secondary"
                          style={{ fontSize: "0.85rem" }}
                          onClick={() => { setSelectedHistoryConvId(c.conversationId); setHistorySteps([]); setHistoryStepsNextCursor(null); }}
                        >
                          View steps
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {historyNextOffset != null && !historyLoadingConvs && (
                  <button
                    type="button"
                    className="button button-secondary"
                    style={{ marginTop: "0.5rem" }}
                    onClick={() => loadHistoryConversations(historyNextOffset)}
                    disabled={historyLoadingConvs}
                  >
                    Load more conversations
                  </button>
                )}
                {!historyLoadingConvs && historyConversations.length === 0 && (
                  <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>No message queue history yet. Send a message in Chat to see steps here.</p>
                )}
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
