"use client";

import {
  Check,
  Copy,
  ThumbsUp,
  ThumbsDown,
  Loader2,
  RotateCw,
  Circle,
  ExternalLink,
} from "lucide-react";
import {
  ChatMessageContent,
  ChatMessageResourceLinks,
  ChatToolResults,
  getAgentRequestFromToolResults,
  getLoadingStatus,
  getMessageDisplayState,
  getSuggestedOptionsFromToolResults,
  messageContentIndicatesSuccess,
  messageHasSuccessfulToolResults,
  ReasoningContent,
} from "./chat-message-content";
import {
  useMinimumStepsDisplayTime,
  MIN_STEPS_DISPLAY_MS,
} from "../hooks/useMinimumStepsDisplayTime";
import { AgentRequestBlock } from "./agent-request-block";
import { copyToClipboard } from "./chat-modal-utils";
import type { Message } from "./chat-types";

export type ChatModalMessageRowProps = {
  msg: Message;
  index: number;
  messages: Message[];
  loading: boolean;
  copiedMsgId: string | null;
  setCopiedMsgId: (id: string | null) => void;
  openMessageFeedback: (msg: Message, label: "good" | "bad") => void;
  feedbackLabel: "good" | "bad" | null;
  send: (payload?: unknown, optionValue?: string) => void | Promise<void>;
  providerId: string;
  conversationId: string | null;
  getMessageCopyText: (msg: Message) => string;
  onShellCommandApprove?: (command: string) => void;
  onShellCommandAddToAllowlist?: (command: string) => void;
  shellCommandLoading?: boolean;
  optionSending: { messageId: string; label: string } | null;
  setOptionSending: (v: { messageId: string; label: string } | null) => void;
};

export function ChatModalMessageRow({
  msg,
  index,
  messages,
  loading,
  copiedMsgId,
  setCopiedMsgId,
  openMessageFeedback,
  feedbackLabel,
  send,
  providerId,
  conversationId,
  getMessageCopyText,
  onShellCommandApprove,
  onShellCommandAddToAllowlist,
  shellCommandLoading = false,
  optionSending,
  setOptionSending,
}: ChatModalMessageRowProps) {
  const isLastMessage = index === messages.length - 1;
  const hideActionsWhileThinking = loading && isLastMessage && msg.role === "assistant";
  const list = msg.toolResults ?? [];
  const displayState = getMessageDisplayState(msg, { isLast: isLastMessage, loading });
  const effectiveHasFinalResponseContent = useMinimumStepsDisplayTime(
    msg.id,
    displayState.hasFinalResponseContent,
    MIN_STEPS_DISPLAY_MS
  );
  if (displayState.isEmptyPlaceholder) return null;
  const FeedbackActions =
    msg.role === "assistant" && !hideActionsWhileThinking ? (
      <div className="chat-msg-actions">
        <button
          className="chat-rate-btn"
          type="button"
          onClick={async () => {
            const ok = await copyToClipboard(getMessageCopyText(msg));
            if (ok) {
              setCopiedMsgId(msg.id);
              setTimeout(() => setCopiedMsgId(null), 1500);
            }
          }}
          title="Copy message and tool results"
        >
          {copiedMsgId === msg.id ? <Check size={11} /> : <Copy size={11} />}
        </button>
        <button
          className={`chat-rate-btn ${feedbackLabel === "good" ? "chat-rate-btn-active" : ""}`}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openMessageFeedback(msg, "good");
          }}
          title={feedbackLabel === "good" ? "Rated good" : "Good"}
          aria-pressed={feedbackLabel === "good"}
        >
          <ThumbsUp size={11} />
        </button>
        <button
          className={`chat-rate-btn ${feedbackLabel === "bad" ? "chat-rate-btn-active" : ""}`}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openMessageFeedback(msg, "bad");
          }}
          title={feedbackLabel === "bad" ? "Rated bad" : "Bad"}
          aria-pressed={feedbackLabel === "bad"}
        >
          <ThumbsDown size={11} />
        </button>
      </div>
    ) : null;
  return (
    <div className={`chat-msg chat-msg-${msg.role}`}>
      {msg.role === "assistant" &&
        isLastMessage &&
        (msg.todos?.length ?? 0) > 0 &&
        !effectiveHasFinalResponseContent && (
          <div className="chat-steps-panel" aria-label="Current steps">
            <span className="chat-steps-panel-title">Steps</span>
            <ul className="chat-steps-list">
              {msg.todos!.map((todo, i) => {
                const done = msg.completedStepIndices?.includes(i) === true;
                const executing = msg.executingStepIndex === i;
                return (
                  <li
                    key={i}
                    className={`chat-steps-item ${done ? "chat-steps-item-done" : ""} ${executing ? "chat-steps-item-executing" : ""}`}
                  >
                    {done ? (
                      <Check
                        size={14}
                        className="chat-steps-icon chat-steps-icon-done"
                        aria-hidden
                      />
                    ) : executing ? (
                      <Circle
                        size={14}
                        className="chat-steps-icon chat-steps-icon-open"
                        aria-hidden
                      />
                    ) : (
                      <Circle
                        size={14}
                        className="chat-steps-icon chat-steps-icon-open"
                        aria-hidden
                      />
                    )}
                    <span className="chat-steps-label">{todo}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      {msg.role === "assistant" &&
        msg.rephrasedPrompt != null &&
        msg.rephrasedPrompt.trim() !== "" && (
          <div className="chat-rephrased-prompt">
            <span className="chat-rephrased-label">Rephrased prompt</span>
            <p className="chat-rephrased-text">{msg.rephrasedPrompt}</p>
          </div>
        )}
      {msg.role === "assistant" &&
        (msg.traceSteps?.length ?? 0) > 0 &&
        !effectiveHasFinalResponseContent &&
        !(loading && isLastMessage) && (
          <div className="chat-trace-steps chat-trace-steps-current" aria-label="Assistant working">
            {conversationId && (
              <a
                href={`/queues?conversation=${encodeURIComponent(conversationId)}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}
              >
                View full queue history →
              </a>
            )}
            <div
              className="chat-trace-step-wrap chat-trace-step-wrap-left"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-start",
                gap: "0.5rem",
              }}
            >
              <span className="chat-trace-step">
                {getLoadingStatus(msg as Parameters<typeof getLoadingStatus>[0])}
              </span>
            </div>
          </div>
        )}
      {msg.role === "assistant" &&
        msg.reasoning &&
        isLastMessage &&
        !effectiveHasFinalResponseContent && (
          <div className="chat-plan">
            <div className="chat-plan-reasoning">
              <span className="chat-plan-label">Reasoning</span>
              <ReasoningContent text={msg.reasoning} />
            </div>
          </div>
        )}
      {(() => {
        const hasAnyToolResults = Array.isArray(list) && list.length > 0;
        const lastAssistantIndex =
          messages
            .map((m, i) => (m.role === "assistant" ? i : -1))
            .filter((i) => i >= 0)
            .pop() ?? -1;
        const isLastAssistantMessage = msg.role === "assistant" && index === lastAssistantIndex;
        const showError =
          isLastAssistantMessage &&
          msg.content.startsWith("Error: ") &&
          !displayState.hasAskUserWaiting &&
          !hasAnyToolResults &&
          !messageHasSuccessfulToolResults(list) &&
          !messageContentIndicatesSuccess(msg.content);
        const lastUserMessage =
          index > 0 && messages[index - 1]?.role === "user" ? messages[index - 1]!.content : "";
        const isRetrying =
          showError &&
          loading &&
          messages[index + 1]?.role === "user" &&
          messages[index + 1]?.content === lastUserMessage;
        const errorText = msg.content.startsWith("Error: ")
          ? msg.content.slice(6).trim()
          : msg.content;
        return (
          <>
            {showError ? (
              <div className="chat-msg-error-placeholder">
                {isRetrying ? (
                  <p className="chat-section-error-retrying">
                    <RotateCw size={14} aria-hidden />
                    Retrying…
                  </p>
                ) : (
                  <>
                    <p>{errorText || "An error occurred."}</p>
                    <div className="chat-msg-error-actions">
                      {lastUserMessage.trim() ? (
                        <button
                          type="button"
                          className="chat-view-traces-btn chat-msg-error-retry"
                          onClick={() => send(undefined, lastUserMessage)}
                          disabled={loading || !providerId}
                          title={
                            !providerId ? "Select an LLM provider first" : "Retry the last message"
                          }
                        >
                          <RotateCw size={12} />
                          Retry
                        </button>
                      ) : null}
                      <a
                        href={
                          conversationId
                            ? `/chat/traces?conversationId=${encodeURIComponent(conversationId)}`
                            : "/chat/traces"
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="chat-view-traces-link"
                      >
                        View stack trace for details <ExternalLink size={12} />
                      </a>
                    </div>
                  </>
                )}
              </div>
            ) : displayState.displayContent.trim() !== "" || displayState.structuredContent ? (
              <>
                <ChatMessageContent
                  content={displayState.displayContent}
                  structuredContent={displayState.structuredContent}
                />
                {displayState.hasAskUserWaiting &&
                  isLastMessage &&
                  !loading &&
                  (() => {
                    const opts =
                      msg.interactivePrompt?.options && msg.interactivePrompt.options.length > 0
                        ? msg.interactivePrompt.options.map((s) => ({ value: s, label: s }))
                        : getSuggestedOptionsFromToolResults(
                            list,
                            displayState.displayContent || ""
                          );
                    if (opts.length === 0) return null;
                    const sendingForThisMsg = optionSending?.messageId === msg.id;
                    const stepIndex = msg.interactivePrompt?.stepIndex;
                    const stepTotal = msg.interactivePrompt?.stepTotal;
                    const showStep = stepIndex != null && stepTotal != null && stepTotal > 0;
                    return (
                      <div
                        className="chat-inline-options agent-request-block-options-wrap"
                        role="group"
                        aria-label="Choose an option"
                        style={{ marginTop: "0.75rem" }}
                      >
                        {showStep && (
                          <span
                            className="agent-request-block-step-indicator"
                            style={{
                              display: "block",
                              marginBottom: "0.25rem",
                              fontSize: "0.875rem",
                              color: "var(--muted-foreground, #71717a)",
                            }}
                          >
                            Step {stepIndex} of {stepTotal}
                          </span>
                        )}
                        <span className="agent-request-block-options-label">Options</span>
                        <ul className="agent-request-block-options-list">
                          {opts.map((opt, optIndex) => {
                            const isSendingThis =
                              sendingForThisMsg && optionSending?.label === opt.label;
                            return (
                              <li key={`option-${optIndex}-${opt.value}`}>
                                <button
                                  type="button"
                                  className="agent-request-block-option-btn"
                                  onClick={() => {
                                    setOptionSending({ messageId: msg.id, label: opt.label });
                                    void send(undefined, opt.label);
                                  }}
                                  disabled={!providerId || sendingForThisMsg}
                                  title="Send this option as your reply"
                                >
                                  {isSendingThis ? (
                                    <>
                                      <Loader2
                                        size={14}
                                        className="spin"
                                        style={{ marginRight: 6, verticalAlign: "middle" }}
                                        aria-hidden
                                      />
                                      Sending…
                                    </>
                                  ) : (
                                    opt.label
                                  )}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })()}
              </>
            ) : null}
          </>
        );
      })()}
      {msg.role === "assistant" &&
        (() => {
          const agentRequest = getAgentRequestFromToolResults(list);
          if (!agentRequest || (!agentRequest.question && agentRequest.options.length === 0))
            return null;
          return (
            <div className="chat-history-agent-request" style={{ marginTop: "0.75rem" }}>
              <AgentRequestBlock
                question={agentRequest.question || undefined}
                options={agentRequest.options}
                viewRunHref={`/runs/${agentRequest.runId}`}
                showVagueHint={false}
              />
            </div>
          );
        })()}
      {msg.role === "assistant" && list.length > 0 && <ChatMessageResourceLinks results={list} />}
      {msg.role === "assistant" &&
        (() => {
          const filtered = list.filter(
            (r) =>
              r.name !== "ask_user" && r.name !== "ask_credentials" && r.name !== "format_response"
          );
          if (filtered.length === 0) return null;
          return (
            <div className="chat-tool-results-wrap">
              <ChatToolResults
                results={filtered}
                onShellCommandApprove={onShellCommandApprove}
                onShellCommandAddToAllowlist={onShellCommandAddToAllowlist}
                shellCommandLoading={shellCommandLoading}
              />
            </div>
          );
        })()}
      {msg.role === "assistant" && msg.todos && msg.todos.length > 0 && !isLastMessage && (
        <div className="chat-plan chat-plan-todos-only">
          <div className="chat-plan-todos">
            <span className="chat-plan-label">Steps</span>
            <ul className="chat-plan-todo-list">
              {msg.todos.map((todo, i) => {
                const done = msg.completedStepIndices?.includes(i);
                const executing = msg.executingStepIndex === i;
                return (
                  <li
                    key={i}
                    className={`chat-plan-todo-item ${done ? "chat-plan-todo-done" : ""} ${executing ? "chat-plan-todo-executing" : ""}`}
                  >
                    {done ? (
                      <Check size={12} className="chat-plan-todo-icon" />
                    ) : executing ? (
                      <Circle size={12} className="chat-plan-todo-icon" />
                    ) : (
                      <Circle size={12} className="chat-plan-todo-icon" />
                    )}
                    <span>{todo}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
      {FeedbackActions}
    </div>
  );
}
