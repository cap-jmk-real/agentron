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
  ChevronDown,
  ChevronRight,
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

export type ChatSectionMessageRowProps = {
  msg: Message;
  index: number;
  messages: Message[];
  loading: boolean;
  collapsedStepsByMsg: Record<string, boolean>;
  setCollapsedStepsByMsg: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  copiedMsgId: string | null;
  setCopiedMsgId: (id: string | null) => void;
  openMessageFeedback: (msg: Message, label: "good" | "bad") => void;
  feedbackLabel: "good" | "bad" | null;
  send: (value: string) => void;
  providerId: string;
  conversationId: string | null;
  getMessageCopyText: (msg: Message) => string;
  onShellCommandApprove?: (command: string) => void;
  onShellCommandAddToAllowlist?: (command: string) => void;
  shellCommandLoading?: boolean;
  optionSending: { messageId: string; label: string } | null;
  setOptionSending: React.Dispatch<
    React.SetStateAction<{ messageId: string; label: string } | null>
  >;
};

export function ChatSectionMessageRow({
  msg,
  index,
  messages,
  loading,
  collapsedStepsByMsg,
  setCollapsedStepsByMsg,
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
}: ChatSectionMessageRowProps) {
  const isLast = index === messages.length - 1;
  const hideActions = loading && isLast && msg.role === "assistant";
  const list = msg.toolResults ?? [];
  const displayState = getMessageDisplayState(msg, { isLast, loading });
  const effectiveHasFinalResponseContent = useMinimumStepsDisplayTime(
    msg.id,
    displayState.hasFinalResponseContent,
    MIN_STEPS_DISPLAY_MS
  );
  const FeedbackActions =
    msg.role === "assistant" && !hideActions ? (
      <div className="chat-section-msg-actions">
        <button
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
          {copiedMsgId === msg.id ? <Check size={14} /> : <Copy size={14} />}
        </button>
        <button
          type="button"
          className={feedbackLabel === "good" ? "chat-section-feedback-btn-active" : ""}
          onClick={(e) => {
            e.stopPropagation();
            openMessageFeedback(msg, "good");
          }}
          title={feedbackLabel === "good" ? "Rated good" : "Good"}
          aria-pressed={feedbackLabel === "good"}
        >
          <ThumbsUp size={14} />
        </button>
        <button
          type="button"
          className={feedbackLabel === "bad" ? "chat-section-feedback-btn-active" : ""}
          onClick={(e) => {
            e.stopPropagation();
            openMessageFeedback(msg, "bad");
          }}
          title={feedbackLabel === "bad" ? "Rated bad" : "Bad"}
          aria-pressed={feedbackLabel === "bad"}
        >
          <ThumbsDown size={14} />
        </button>
      </div>
    ) : null;
  return (
    <div className={`chat-section-msg chat-section-msg-${msg.role}`}>
      {msg.role === "assistant" &&
        msg.rephrasedPrompt != null &&
        msg.rephrasedPrompt.trim() !== "" && (
          <div className="chat-section-rephrased">
            <span className="chat-section-rephrased-label">Rephrased</span>
            <p className="chat-section-rephrased-text">{msg.rephrasedPrompt}</p>
          </div>
        )}
      {msg.role === "assistant" &&
        (msg.traceSteps?.length ?? 0) > 0 &&
        !effectiveHasFinalResponseContent &&
        !(loading && isLast) && (
          <div
            className="chat-section-trace-steps chat-section-trace-steps-current"
            aria-label="Assistant working"
          >
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
              className="chat-section-trace-step-wrap chat-section-trace-step-wrap-left"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-start",
                gap: "0.5rem",
              }}
            >
              <span className="chat-section-trace-step">
                {getLoadingStatus(msg as Parameters<typeof getLoadingStatus>[0])}
              </span>
            </div>
          </div>
        )}
      {msg.role === "assistant" && msg.reasoning && isLast && !effectiveHasFinalResponseContent && (
        <div className="chat-section-plan">
          <span className="chat-section-plan-label">Reasoning</span>
          <ReasoningContent text={msg.reasoning} />
        </div>
      )}
      {msg.role === "assistant" &&
        msg.todos &&
        msg.todos.length > 0 &&
        !effectiveHasFinalResponseContent && (
          <div className="chat-section-todos-wrap">
            {(() => {
              const allDone =
                msg.completedStepIndices && msg.completedStepIndices.length >= msg.todos!.length;
              const collapsed = collapsedStepsByMsg[msg.id] ?? !!allDone;
              const toggle = () =>
                setCollapsedStepsByMsg((prev) => ({
                  ...prev,
                  [msg.id]: !collapsed,
                }));
              return (
                <>
                  <button
                    type="button"
                    onClick={toggle}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      width: "100%",
                      background: "transparent",
                      border: "none",
                      padding: 0,
                      margin: 0,
                      cursor: "pointer",
                      font: "inherit",
                    }}
                  >
                    <span className="chat-section-todos-label">Steps</span>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: "0.78rem",
                        color: "var(--text-muted)",
                      }}
                    >
                      {allDone ? "Done" : "In progress"}
                      {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    </span>
                  </button>
                  {!collapsed && (
                    <ul className="chat-section-todos">
                      {msg.todos.map((todo, i) => (
                        <li
                          key={i}
                          className={
                            msg.completedStepIndices?.includes(i)
                              ? "done"
                              : msg.executingStepIndex === i
                                ? "active"
                                : ""
                          }
                        >
                          <span className="chat-section-todo-icon">
                            {msg.completedStepIndices?.includes(i) ? (
                              <Check size={12} />
                            ) : msg.executingStepIndex === i ? (
                              <Circle size={12} />
                            ) : (
                              <Circle size={12} />
                            )}
                          </span>
                          <span className="chat-section-todo-text">{todo}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              );
            })()}
          </div>
        )}
      {(() => {
        const filtered = list.filter(
          (r) =>
            r.name !== "ask_user" && r.name !== "ask_credentials" && r.name !== "format_response"
        );
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
              <div className="chat-section-error">
                {isRetrying ? (
                  <p className="chat-section-error-retrying">
                    <RotateCw size={14} aria-hidden />
                    Retrying…
                  </p>
                ) : (
                  <>
                    <p>{errorText || "Something went wrong."}</p>
                    <div className="chat-section-error-actions">
                      {lastUserMessage.trim() ? (
                        <button
                          type="button"
                          className="chat-section-error-retry"
                          onClick={() => send(lastUserMessage)}
                          disabled={loading || !providerId}
                          title={
                            !providerId ? "Select an LLM provider first" : "Retry the last message"
                          }
                        >
                          <RotateCw size={14} />
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
                      >
                        View stack trace <ExternalLink size={12} />
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
                {(() => {
                  const wouldShowOptions = displayState.hasAskUserWaiting && isLast && !loading;
                  if (!wouldShowOptions) return null;
                  const opts =
                    msg.interactivePrompt?.options && msg.interactivePrompt.options.length > 0
                      ? msg.interactivePrompt.options.map((s) => ({ value: s, label: s }))
                      : getSuggestedOptionsFromToolResults(list, displayState.displayContent || "");
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
                                  void send(opt.label);
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
                {msg.role === "assistant" &&
                  (() => {
                    const agentRequest = getAgentRequestFromToolResults(list);
                    if (
                      !agentRequest ||
                      (!agentRequest.question && agentRequest.options.length === 0)
                    )
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
              </>
            ) : null}
            {list.length > 0 ? <ChatMessageResourceLinks results={list} /> : null}
            {filtered.length > 0 ? (
              <ChatToolResults
                results={filtered}
                onShellCommandApprove={onShellCommandApprove}
                onShellCommandAddToAllowlist={onShellCommandAddToAllowlist}
                shellCommandLoading={shellCommandLoading}
              />
            ) : null}
          </>
        );
      })()}
      {FeedbackActions}
    </div>
  );
}
