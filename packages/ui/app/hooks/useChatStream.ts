"use client";

import { useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import type { ChatStreamEvent } from "../api/chat/types";
import { dispatchNotificationsUpdated } from "../lib/notifications-events";

export type ChatStreamMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolResults?: { name: string; args: Record<string, unknown>; result: unknown }[];
  status?: "completed" | "waiting_for_input";
  interactivePrompt?: { question: string; options?: string[]; stepIndex?: number; stepTotal?: number };
  reasoning?: string;
  todos?: string[];
  completedStepIndices?: number[];
  executingStepIndex?: number;
  executingToolName?: string;
  executingTodoLabel?: string;
  executingSubStepLabel?: string;
  rephrasedPrompt?: string | null;
  traceSteps?: { phase: string; label?: string; contentPreview?: string; inputPreview?: string; specialistId?: string; toolName?: string; toolInput?: unknown; toolOutput?: unknown }[];
};

export type UseChatStreamParams = {
  messages: ChatStreamMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatStreamMessage[]>>;
  loading: boolean;
  setLoading: (v: boolean) => void;
  input: string;
  setInput: (v: string) => void;
  providerId: string;
  conversationId: string | null;
  setConversationId: (v: string | null) => void;
  conversationList: { id: string; title: string | null; rating: number | null; note: string | null; createdAt: number }[];
  setConversationList: React.Dispatch<React.SetStateAction<{ id: string; title: string | null; rating: number | null; note: string | null; createdAt: number }[]>>;
  pathname: string | null;
  getUiContext: (pathname: string | null) => string;
  buildBody?: (base: Record<string, unknown>) => Record<string, unknown>;
  onRunFinished?: (runId: string, status: string, details?: { question?: string; options?: string[] }) => void;
  randomId: () => string;
};

/** Process a single chat stream event and update state via handlers. */
export function processChatStreamEvent(
  event: ChatStreamEvent,
  ctx: {
    placeholderId: string;
    userMsgId: string;
    updatePlaceholder: (u: Partial<ChatStreamMessage>, flush?: boolean) => void;
    setMessages: React.Dispatch<React.SetStateAction<ChatStreamMessage[]>>;
    setConversationId: (v: string | null) => void;
    setConversationList: React.Dispatch<React.SetStateAction<{ id: string; title: string | null; rating: number | null; note: string | null; createdAt: number }[]>>;
    doneReceived: { current: boolean };
    onRunFinished?: (runId: string, status: string, details?: { question?: string; options?: string[] }) => void;
    onDone?: () => void;
  }
): void {
  if (event.type === "trace_step") {
    const step: { phase: string; label?: string; contentPreview?: string; inputPreview?: string; specialistId?: string; toolName?: string; toolInput?: unknown; toolOutput?: unknown } = {
      phase: event.phase ?? "",
      label: event.label,
      contentPreview: event.contentPreview,
    };
    if (event.inputPreview != null) step.inputPreview = event.inputPreview;
    if (event.specialistId != null) step.specialistId = event.specialistId;
    if (event.toolName != null) step.toolName = event.toolName;
    if (event.toolInput !== undefined) step.toolInput = event.toolInput;
    if (event.toolOutput !== undefined) step.toolOutput = event.toolOutput;
    ctx.setMessages((prev) => {
      // #region agent log
      const hasPlaceholder = prev.some((m) => m.id === ctx.placeholderId);
      if (typeof fetch !== "undefined") fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"840831"},body:JSON.stringify({sessionId:"840831",location:"useChatStream.ts:trace_step",message:"trace_step setMessages",data:{hasPlaceholder,prevLen:prev.length,placeholderIdPrefix:ctx.placeholderId.slice(0,8)},hypothesisId:"H1",timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return prev.map((m) =>
        m.id === ctx.placeholderId ? { ...m, traceSteps: [...(m.traceSteps ?? []), step] } : m
      );
    });
  } else if (event.type === "content_delta" && "delta" in event && typeof event.delta === "string") {
    ctx.setMessages((prev) => {
      // #region agent log
      const hasPlaceholder = prev.some((m) => m.id === ctx.placeholderId);
      if (typeof fetch !== "undefined") fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"840831"},body:JSON.stringify({sessionId:"840831",location:"useChatStream.ts:content_delta",message:"content_delta setMessages",data:{hasPlaceholder,prevLen:prev.length},hypothesisId:"H1",timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return prev.map((m) =>
        m.id === ctx.placeholderId ? { ...m, content: (m.content ?? "") + event.delta } : m
      );
    });
  } else if (event.type === "rephrased_prompt" && event.rephrasedPrompt != null) {
    ctx.updatePlaceholder({ rephrasedPrompt: event.rephrasedPrompt });
  } else if (event.type === "plan") {
    ctx.updatePlaceholder({
      reasoning: event.reasoning ?? "",
      todos: event.todos ?? [],
      completedStepIndices: [],
      executingStepIndex: undefined,
      executingToolName: undefined,
      executingTodoLabel: undefined,
      executingSubStepLabel: undefined,
    }, true);
  } else if (event.type === "step_start" && event.stepIndex !== undefined) {
    ctx.updatePlaceholder({
      executingStepIndex: event.stepIndex,
      executingToolName: (event as { toolName?: string }).toolName,
      executingTodoLabel: (event as { todoLabel?: string }).todoLabel,
      executingSubStepLabel: (event as { subStepLabel?: string }).subStepLabel,
    }, true);
  } else if (event.type === "todo_done" && event.index !== undefined) {
    flushSync(() =>
      ctx.setMessages((prev) =>
        prev.map((m) =>
          m.id === ctx.placeholderId
            ? {
                ...m,
                completedStepIndices: [...(m.completedStepIndices ?? []), event.index!],
                executingStepIndex: undefined,
                executingToolName: undefined,
                executingTodoLabel: undefined,
                executingSubStepLabel: undefined,
              }
            : m
        )
      )
    );
  } else if (event.type === "done") {
    ctx.doneReceived.current = true;
    // #region agent log
    if (typeof fetch !== "undefined") fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"ce22a5"},body:JSON.stringify({sessionId:"ce22a5",location:"useChatStream.ts:done",message:"done event received",data:{placeholderIdPrefix:ctx.placeholderId.slice(0,8),contentLen:(event.content??"").length},hypothesisId:"H2",timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    ctx.updatePlaceholder({
      content: event.content ?? "",
      toolResults: event.toolResults,
      ...(event.status !== undefined && { status: event.status }),
      ...(event.interactivePrompt && { interactivePrompt: event.interactivePrompt }),
      ...(event.reasoning !== undefined && { reasoning: event.reasoning }),
      ...(event.todos !== undefined && { todos: event.todos }),
      completedStepIndices: event.completedStepIndices,
      executingStepIndex: undefined,
      executingToolName: undefined,
      executingTodoLabel: undefined,
      executingSubStepLabel: undefined,
      ...(event.rephrasedPrompt !== undefined && { rephrasedPrompt: event.rephrasedPrompt }),
    }, true);
    if (event.messageId) ctx.setMessages((prev) => prev.map((m) => (m.id === ctx.placeholderId ? { ...m, id: event.messageId! } : m)));
    if (event.userMessageId) ctx.setMessages((prev) => prev.map((m) => (m.id === ctx.userMsgId ? { ...m, id: event.userMessageId! } : m)));
    if (event.conversationId) {
      // #region agent log
      if (typeof fetch !== "undefined") fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({location:"useChatStream:done_set_conversationId",message:"stream done sets conversationId",data:{newConversationId:event.conversationId},hypothesisId:"H1",timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      ctx.setConversationId(event.conversationId);
      const newTitle = event.conversationTitle ?? null;
      ctx.setConversationList((prev) => {
        const has = prev.some((c) => c.id === event.conversationId);
        if (has) return prev.map((c) => (c.id === event.conversationId ? { ...c, title: newTitle ?? c.title } : c));
        return [{ id: event.conversationId!, title: newTitle, rating: null, note: null, createdAt: Date.now() }, ...prev];
      });
    }
    // Use the last execute_workflow result so we show the final run state (e.g. waiting_for_user after a retry), not the first (e.g. failed)
    const execWfResults = event.toolResults?.filter((r: { name: string; result?: unknown }) => r.name === "execute_workflow") ?? [];
    const lastExecWf = execWfResults.length > 0 ? execWfResults[execWfResults.length - 1] : undefined;
    const wfResult = lastExecWf?.result as { id?: string; status?: string; question?: string; options?: string[] } | undefined;
    const terminalStatuses = ["completed", "waiting_for_user", "failed", "cancelled"] as const;
    if (wfResult?.id && wfResult.status && terminalStatuses.includes(wfResult.status as (typeof terminalStatuses)[number]) && ctx.onRunFinished) {
      const details = wfResult.status === "waiting_for_user" && (wfResult.question || (Array.isArray(wfResult.options) && wfResult.options.length > 0))
        ? { question: wfResult.question, options: Array.isArray(wfResult.options) ? wfResult.options : undefined }
        : undefined;
      ctx.onRunFinished(wfResult.id, wfResult.status, details);
    }
    ctx.onDone?.();
  } else if (event.type === "error") {
    if (!ctx.doneReceived.current) {
      const errorContent = `Error: ${event.error ?? "Unknown error"}`;
      if (event.messageId) {
        ctx.setMessages((prev) => prev.map((m) => (m.id === ctx.placeholderId ? { ...m, id: event.messageId!, content: errorContent, traceSteps: [] } : m)));
      } else {
        ctx.updatePlaceholder({ content: errorContent, traceSteps: [] });
      }
    }
    if (event.userMessageId) {
      ctx.setMessages((prev) => prev.map((m) => (m.id === ctx.userMsgId ? { ...m, id: event.userMessageId! } : m)));
    }
  }
}

/** Map API chat response rows to ChatStreamMessage format. */
export function mapApiMessagesToMessage(
  data: unknown[],
  normalizeToolResults: (raw: unknown) => { name: string; args: Record<string, unknown>; result: unknown }[]
): ChatStreamMessage[] {
  if (!Array.isArray(data)) return [];
  return data.map((m) => {
    const row = m as Record<string, unknown>;
    const raw = row.toolCalls;
    const toolResults = normalizeToolResults(raw);
    return {
      id: row.id as string,
      role: row.role as "user" | "assistant",
      content: row.content as string,
      toolResults,
      ...(row.status !== undefined && { status: row.status as "completed" | "waiting_for_input" }),
      ...(row.interactivePrompt != null && { interactivePrompt: row.interactivePrompt as { question: string; options?: string[] } }),
    } as ChatStreamMessage;
  });
}

export type PerformChatStreamSendParams = {
  text: string;
  messages: ChatStreamMessage[];
  placeholderId: string;
  userMsgId: string;
  conversationId: string | null;
  providerId: string;
  uiContext: string;
  setMessages: React.Dispatch<React.SetStateAction<ChatStreamMessage[]>>;
  setConversationId: (v: string | null) => void;
  setConversationList: React.Dispatch<React.SetStateAction<{ id: string; title: string | null; rating: number | null; note: string | null; createdAt: number }[]>>;
  setLoading: (v: boolean) => void;
  abortSignal: AbortSignal | undefined;
  randomId: () => string;
  normalizeToolResults: (raw: unknown) => { name: string; args: Record<string, unknown>; result: unknown }[];
  /** Build final request body; base has message, history, providerId, uiContext, conversationId */
  buildBody: (base: Record<string, unknown>) => Record<string, unknown>;
  /** Optional extra fields merged into the request body (e.g. continueShellApproval) */
  extraBody?: Record<string, unknown>;
  onRunFinished?: (runId: string, status: string, details?: { question?: string; options?: string[] }) => void;
  onDone?: () => void;
  onAbort?: () => void;
  onInputRestore?: (text: string) => void;
};

/** Shared stream send logic: fetch, process events, fetch fallback when done not received. */
export async function performChatStreamSend(params: PerformChatStreamSendParams): Promise<void> {
  const {
    text,
    messages,
    placeholderId,
    userMsgId,
    conversationId,
    providerId,
    uiContext,
    setMessages,
    setConversationId,
    setConversationList,
    setLoading,
    abortSignal,
    normalizeToolResults,
    buildBody,
    extraBody,
    onRunFinished,
    onDone,
    onAbort,
    onInputRestore,
  } = params;

  const updatePlaceholder = (updates: Partial<ChatStreamMessage>, flush = false) => {
    const updater = () =>
      setMessages((prev) =>
        prev.map((m) => (m.id === placeholderId ? { ...m, ...updates } : m))
      );
    if (flush) flushSync(updater);
    else updater();
  };
  const doneReceivedRef = { current: false };
  let pollTimer: ReturnType<typeof setTimeout> | undefined;

  try {
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    const body = {
      ...buildBody({
        message: text,
        history,
        providerId: providerId || undefined,
        uiContext,
        conversationId: conversationId ?? undefined,
      }),
      ...(extraBody ?? {}),
    };

    // #region agent log
    if (typeof fetch !== "undefined") fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"e0760a"},body:JSON.stringify({sessionId:"e0760a",location:"useChatStream.ts:before_fetch",message:"client sending message",data:{conversationId:body.conversationId ?? null,messageLen:(text||"").length},hypothesisId:"H1",timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const res = await fetch("/api/chat?stream=1", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal: abortSignal,
      credentials: "same-origin",
    });

    if (!res.ok) {
      const raw = await res.text();
      let errMsg = "Request failed";
      try {
        const data = raw ? JSON.parse(raw) : {};
        const e = data.error?.trim().replace(/^\.\s*/, "") || "";
        if (e && e !== ".") errMsg = e;
      } catch {}
      updatePlaceholder({ content: `Error: ${errMsg}`, traceSteps: [] });
      setLoading(false);
      return;
    }

    // Decoupled: expect 202 + turnId, then subscribe to events via SSE
    if (res.status !== 202) {
      updatePlaceholder({ content: "Error: Expected decoupled response (202).", traceSteps: [] });
      setLoading(false);
      return;
    }

    let turnId: string;
    let responseConversationId: string | undefined;
    try {
      const data = await res.json();
      turnId = typeof data?.turnId === "string" ? data.turnId : "";
      responseConversationId = typeof data?.conversationId === "string" ? data.conversationId : undefined;
    } catch {
      updatePlaceholder({ content: "Error: Invalid response (no turnId).", traceSteps: [] });
      setLoading(false);
      return;
    }
    if (!turnId) {
      updatePlaceholder({ content: "Error: Missing turnId.", traceSteps: [] });
      setLoading(false);
      return;
    }

    dispatchNotificationsUpdated();

    if (responseConversationId) {
      setConversationId(responseConversationId);
      setConversationList((prev) => {
        if (prev.some((c) => c.id === responseConversationId)) return prev;
        return [{ id: responseConversationId!, title: null, rating: null, note: null, createdAt: Date.now() }, ...prev];
      });
    }

    const eventSource = new EventSource(`/api/chat/events?turnId=${encodeURIComponent(turnId)}`);
    const cidForPoll = responseConversationId ?? (body.conversationId as string | undefined);
    /** Minimum message count we expect from API before replacing: current list + new user msg + placeholder. Only replace when API has at least that many (so the new assistant message is persisted). Avoids poll overwriting continuation turns. */
    const minMessagesForPollReplace = messages.length + 2;
    const POLL_AFTER_MS = 6500;
    pollTimer =
      cidForPoll && typeof cidForPoll === "string"
        ? setTimeout(async () => {
            if (doneReceivedRef.current) return;
            try {
              const r = await fetch(`/api/chat?conversationId=${encodeURIComponent(cidForPoll)}`, {
                cache: "no-store",
                credentials: "same-origin",
              });
              if (!r.ok) return;
              const data = await r.json();
              if (!Array.isArray(data)) return;
              const willReplace = data.length >= minMessagesForPollReplace;
              if (typeof fetch !== "undefined") fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"840831"},body:JSON.stringify({sessionId:"840831",location:"useChatStream.ts:poll",message:"poll ran",data:{dataLen:data.length,minMessagesForPollReplace,willReplace},hypothesisId:"H2",timestamp:Date.now()})}).catch(()=>{});
              if (data.length < minMessagesForPollReplace) return;
              const apiMessages: ChatStreamMessage[] = data.map((m: Record<string, unknown>) => {
                const raw = m.toolCalls;
                const toolResults = Array.isArray(raw)
                  ? (raw as { name?: string; arguments?: unknown; result?: unknown }[]).map((t) => ({
                      name: (t?.name as string) ?? "",
                      args: (typeof t?.arguments === "object" && t?.arguments != null ? t.arguments : {}) as Record<string, unknown>,
                      result: t?.result,
                    }))
                  : undefined;
                return {
                  id: (m.id as string) ?? "",
                  role: (m.role as "user" | "assistant") ?? "assistant",
                  content: (m.content as string) ?? "",
                  toolResults,
                  ...(m.status !== undefined && { status: m.status as "completed" | "waiting_for_input" }),
                  ...(m.interactivePrompt != null && { interactivePrompt: m.interactivePrompt as ChatStreamMessage["interactivePrompt"] }),
                };
              });
              setMessages(apiMessages);
              setLoading(false);
              try {
                eventSource.close();
              } catch {
                //
              }
            } catch {
              //
            }
          }, POLL_AFTER_MS)
        : undefined;

    const processEvent = (raw: string) => {
      try {
        const event = JSON.parse(raw) as ChatStreamEvent;
        processChatStreamEvent(event, {
          placeholderId,
          userMsgId,
          updatePlaceholder,
          setMessages,
          setConversationId,
          setConversationList,
          doneReceived: doneReceivedRef,
          onRunFinished,
          onDone,
        });
      } catch {
        // skip malformed event
      }
    };

    eventSource.onmessage = (e) => {
      if (!e.data) return;
      try {
        const event = JSON.parse(e.data) as { type?: string };
        // Clear poll timer before processing done/error so a later poll never overwrites the just-updated state.
        if (event.type === "done" || event.type === "error") {
          if (pollTimer != null) {
            clearTimeout(pollTimer);
            pollTimer = undefined;
          }
        }
      } catch {
        //
      }
      // #region agent log
      try {
        const parsed = JSON.parse(e.data) as { type?: string };
        if (parsed.type === "trace_step" || parsed.type === "step_start" || parsed.type === "plan") {
          if (typeof fetch !== "undefined") fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"e0760a"},body:JSON.stringify({sessionId:"e0760a",location:"useChatStream.ts:onmessage",message:"SSE event received",data:{eventType:parsed.type,placeholderId},hypothesisId:"H3",timestamp:Date.now()})}).catch(()=>{});
        }
      } catch { /* ignore */ }
      // #endregion
      processEvent(e.data);
      try {
        const event = JSON.parse(e.data) as { type?: string };
        if (event.type === "done" || event.type === "error") {
          // #region agent log
          if (typeof fetch !== "undefined") fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"26876c"},body:JSON.stringify({sessionId:"26876c",location:"useChatStream:done_or_error",message:"SSE done/error, setting loading false",data:{eventType:event.type},hypothesisId:"H5_response",timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          eventSource.close();
          setLoading(false);
        }
      } catch {
        //
      }
    };
    const fetchConversationFallback = async (): Promise<boolean> => {
      // #region agent log
      if (typeof fetch !== "undefined") fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"ce22a5"},body:JSON.stringify({sessionId:"ce22a5",location:"useChatStream.ts:fallback_enter",message:"fallback entered",data:{hasCidForPoll:!!cidForPoll,doneReceived:doneReceivedRef.current,minMessagesForPollReplace},hypothesisId:"H3",timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      if (!cidForPoll || doneReceivedRef.current) return false;
      const doFetch = async (): Promise<{ data: unknown[] } | null> => {
        const r = await fetch(`/api/chat?conversationId=${encodeURIComponent(cidForPoll)}`, {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!r.ok) return null;
        const data = await r.json();
        return Array.isArray(data) ? { data } : null;
      };
      const mapToMessages = (data: unknown[]): ChatStreamMessage[] =>
        data.map((m) => {
          const row = m as Record<string, unknown>;
          const raw = row.toolCalls;
          const toolResults = Array.isArray(raw)
            ? (raw as { name?: string; arguments?: unknown; result?: unknown }[]).map((t) => ({
                name: (t?.name as string) ?? "",
                args: (typeof t?.arguments === "object" && t?.arguments != null ? t.arguments : {}) as Record<string, unknown>,
                result: t?.result,
              }))
            : undefined;
          return {
            id: (row.id as string) ?? "",
            role: (row.role as "user" | "assistant") ?? "assistant",
            content: (row.content as string) ?? "",
            toolResults,
            ...(row.status !== undefined && { status: row.status as "completed" | "waiting_for_input" }),
            ...(row.interactivePrompt != null && { interactivePrompt: row.interactivePrompt as ChatStreamMessage["interactivePrompt"] }),
          };
        });
      try {
        let result = await doFetch();
        if (result && result.data.length >= minMessagesForPollReplace) {
          // #region agent log
          if (typeof fetch !== "undefined") fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"ce22a5"},body:JSON.stringify({sessionId:"ce22a5",location:"useChatStream.ts:fallback_fetch",message:"onerror fallback replace",data:{apiLen:result.data.length,minMessagesForPollReplace},hypothesisId:"H3",timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          setMessages(mapToMessages(result.data));
          // #region agent log
          if (typeof fetch !== "undefined") fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"ce22a5"},body:JSON.stringify({sessionId:"ce22a5",location:"useChatStream.ts:fallback_applied",message:"fallback setMessages done",data:{apiLen:result.data.length},hypothesisId:"H3",timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          return true;
        }
        if (!result || result.data.length < minMessagesForPollReplace) {
          // Too few messages or fetch failed; server may not have persisted yet. Retry once after short delay.
          await new Promise((r) => setTimeout(r, 1500));
          if (doneReceivedRef.current) return false;
          result = await doFetch();
        }
        if (result && result.data.length >= minMessagesForPollReplace) {
          // #region agent log
          if (typeof fetch !== "undefined") fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"ce22a5"},body:JSON.stringify({sessionId:"ce22a5",location:"useChatStream.ts:fallback_fetch_retry",message:"onerror fallback replace after retry",data:{apiLen:result.data.length},hypothesisId:"H3",timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          setMessages(mapToMessages(result.data));
          // #region agent log
          if (typeof fetch !== "undefined") fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"ce22a5"},body:JSON.stringify({sessionId:"ce22a5",location:"useChatStream.ts:fallback_applied",message:"fallback setMessages after retry",data:{apiLen:result.data.length},hypothesisId:"H3",timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          return true;
        }
        // #region agent log
        if (typeof fetch !== "undefined") fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"ce22a5"},body:JSON.stringify({sessionId:"ce22a5",location:"useChatStream.ts:fallback_fetch",message:"onerror fallback no replace",data:{apiLen:result?.data?.length??0,minMessagesForPollReplace},hypothesisId:"H3",timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        return false;
      } catch {
        return false;
      }
    };

    eventSource.onerror = () => {
      // #region agent log
      if (typeof fetch !== "undefined") fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"ce22a5"},body:JSON.stringify({sessionId:"ce22a5",location:"useChatStream.ts:onerror",message:"EventSource onerror",data:{doneReceived:doneReceivedRef.current},hypothesisId:"H3",timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      if (pollTimer != null) clearTimeout(pollTimer);
      eventSource.close();
      if (!doneReceivedRef.current) {
        void fetchConversationFallback().then((replaced) => {
          if (!replaced) {
            updatePlaceholder({ content: "Request failed or connection lost. You can try again or refresh the page.", traceSteps: [] });
          }
          setLoading(false);
        });
      } else {
        setLoading(false);
      }
    };
  } catch (err) {
    // #region agent log
    if (typeof fetch !== "undefined") fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"e0760a"},body:JSON.stringify({sessionId:"e0760a",location:"useChatStream.ts:catch",message:"chat fetch threw",data:{name:err instanceof Error?err.name:"",message:err instanceof Error?err.message:String(err)},hypothesisId:"H3",timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (err instanceof Error && err.name === "AbortError") {
      setMessages((prev) => prev.filter((m) => m.id !== placeholderId));
      onAbort?.();
      if (onInputRestore) onInputRestore(text);
    } else {
      updatePlaceholder({ content: "Request failed or connection lost. You can try again or refresh the page.", traceSteps: [] });
      setLoading(false);
    }
  } finally {
    if (pollTimer != null) clearTimeout(pollTimer);
    // #region agent log
    if (typeof fetch !== "undefined") fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"26876c"},body:JSON.stringify({sessionId:"26876c",location:"useChatStream:finally",message:"performChatStreamSend finally ran",data:{},hypothesisId:"H5_response",timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    // Do NOT setLoading(false) here: try block exits immediately after opening EventSource, so this would clear loading before any SSE events. Loading is cleared on done/error event, onerror, or poll replace.
  }
}
