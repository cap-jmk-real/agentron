"use client";

import React from "react";

export type AgentRequestData = {
  question?: string;
  options?: string[];
  runId?: string;
};

type AgentRequestBlockProps = {
  /** Full question/text the agent is asking (from request_user_help). */
  question?: string;
  /** Optional choices; rendered as buttons when onReplyOption is provided. */
  options?: string[];
  /** Run ID for "View run" link. */
  runId?: string;
  /** When set, options are rendered as clickable buttons that call this with the option value. */
  onReplyOption?: (value: string) => void;
  /** When set, show "View run" link. */
  viewRunHref?: string;
  /** When set, show "Cancel run" button. */
  onCancelRun?: () => void;
  /** Optional class for the container. */
  className?: string;
  /** If true, show a short hint when question is vague or short. */
  showVagueHint?: boolean;
};

const VAGUE_HINT =
  "Reply in the box below with your choice or answer (e.g. which item to use), or open the run to respond there.";

function isVagueQuestion(q: string): boolean {
  const t = q.trim().toLowerCase();
  if (t.length < 40) return true;
  return /choose one|pick one|select one|need your input/i.test(t);
}

/**
 * Dedicated UI block that shows what the agent needs from the user when a run is waiting_for_user.
 * Renders the full question and optional choices (as buttons or list). Used in chat-section, chat-modal, and run page.
 */
export function AgentRequestBlock({
  question,
  options = [],
  runId,
  onReplyOption,
  viewRunHref,
  onCancelRun,
  className = "",
  showVagueHint = true,
}: AgentRequestBlockProps) {
  const displayQuestion = question?.trim() || "The agent is waiting for your input.";
  const showHint = showVagueHint && (!question?.trim() || question.trim().length < 40 || isVagueQuestion(question.trim()));
  const hasOptions = Array.isArray(options) && options.length > 0;

  return (
    <div className={`agent-request-block ${className}`.trim()} role="region" aria-label="Agent request">
      <div className="agent-request-block-header">
        <strong className="agent-request-block-title">What the agent needs</strong>
      </div>
      <div className="agent-request-block-body">
        <div
          className="agent-request-block-question"
          style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
          title={displayQuestion}
        >
          {displayQuestion}
        </div>
        {showHint && (
          <p className="agent-request-block-hint">{VAGUE_HINT}</p>
        )}
        {hasOptions && (
          <div className="agent-request-block-options-wrap">
            <span className="agent-request-block-options-label">Options:</span>
            {onReplyOption ? (
              <ul className="agent-request-block-options-list" role="group" aria-label="Reply options">
                {options.filter((s): s is string => typeof s === "string").map((s, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className="agent-request-block-option-btn"
                      onClick={() => onReplyOption(s)}
                      title="Send this as your reply"
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="agent-request-block-options-inline">
                {options.filter((s): s is string => typeof s === "string").join(", ")}
              </span>
            )}
          </div>
        )}
      </div>
      {(viewRunHref || onCancelRun) && (
        <div className="agent-request-block-actions">
          {viewRunHref && (
            <a href={viewRunHref} target="_blank" rel="noopener noreferrer" className="agent-request-block-link">
              View run
            </a>
          )}
          {onCancelRun && (
            <button type="button" className="agent-request-block-cancel" onClick={onCancelRun}>
              Cancel run
            </button>
          )}
        </div>
      )}
    </div>
  );
}
