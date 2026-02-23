"use client";

import { List, ArrowUp, Square, Star, Sparkles, Bot, Network } from "lucide-react";
import { getLoadingStatus } from "./chat-message-content";
import LogoLoading from "./logo-loading";
import BrandIcon from "./brand-icon";
import { AgentRequestBlock } from "./agent-request-block";
import { ChatSectionMessageRow } from "./chat-section-message-row";
import { StyledSelect } from "./styled-select";
import type { Message } from "./chat-types";

export type LlmProvider = { id: string; provider: string; model: string; endpoint?: string };

export type ChatSectionMainProps = {
  sidebarOpen: boolean;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  loaded: boolean;
  messages: Message[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  providers: LlmProvider[];
  loading: boolean;
  lastMsg: Message | undefined;
  collapsedStepsByMsg: Record<string, boolean>;
  setCollapsedStepsByMsg: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  copiedMsgId: string | null;
  setCopiedMsgId: React.Dispatch<React.SetStateAction<string | null>>;
  openMessageFeedback: (msg: Message, label: "good" | "bad") => void;
  feedbackByContentKey: Record<string, "good" | "bad">;
  feedbackContentKey: (prev: string, out: string) => string;
  send: (textOverride?: string, extraBody?: Record<string, unknown>) => void | Promise<void>;
  providerId: string;
  conversationId: string | null;
  getMessageCopyText: (msg: Message) => string;
  handleShellCommandApprove: (command: string) => Promise<void>;
  handleShellCommandAddToAllowlist: (command: string) => Promise<void>;
  shellCommandLoading: boolean;
  optionSending: { messageId: string; label: string } | null;
  setOptionSending: React.Dispatch<
    React.SetStateAction<{ messageId: string; label: string } | null>
  >;
  runWaiting: boolean;
  runWaitingData: { runId: string; question?: string; options?: string[] } | null;
  runWaitingOptionSending: string | null;
  setRunWaitingOptionSending: React.Dispatch<React.SetStateAction<string | null>>;
  onCancelRun: () => Promise<void>;
  handleProviderChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  chatMode: "traditional" | "heap";
  handleChatModeChange: (mode: "traditional" | "heap") => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  lastLocalInputChangeAtRef: React.MutableRefObject<number>;
  resizeInput: () => void;
  stopRequest: () => void;
  setShowFeedbackModal: (v: boolean) => void;
};

export function ChatSectionMain(props: ChatSectionMainProps) {
  const {
    sidebarOpen,
    setSidebarOpen,
    loaded,
    messages,
    scrollRef,
    providers,
    loading,
    lastMsg,
    collapsedStepsByMsg,
    setCollapsedStepsByMsg,
    copiedMsgId,
    setCopiedMsgId,
    openMessageFeedback,
    feedbackByContentKey,
    feedbackContentKey,
    send,
    providerId,
    conversationId,
    getMessageCopyText,
    handleShellCommandApprove,
    handleShellCommandAddToAllowlist,
    shellCommandLoading,
    optionSending,
    setOptionSending,
    runWaiting,
    runWaitingData,
    runWaitingOptionSending,
    setRunWaitingOptionSending,
    onCancelRun,
    handleProviderChange,
    chatMode,
    handleChatModeChange,
    inputRef,
    input,
    setInput,
    lastLocalInputChangeAtRef,
    resizeInput,
    stopRequest,
    setShowFeedbackModal,
  } = props;

  return (
    <div className="chat-section-main">
      <header className="chat-section-header">
        {!sidebarOpen && (
          <button
            type="button"
            className="chat-section-menu-btn"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <List size={20} />
          </button>
        )}
        <span className="chat-section-brand">Agentron</span>
      </header>

      <div className="chat-section-messages" ref={scrollRef}>
        {!loaded && messages.length === 0 ? (
          <div className="chat-section-loading">Loading…</div>
        ) : messages.length === 0 ? (
          <div className="chat-section-welcome">
            <div className="chat-section-welcome-icon">
              <BrandIcon size={64} />
            </div>
            <h2 className="chat-section-welcome-title">How can I help?</h2>
            <p className="chat-section-welcome-sub">
              Ask anything about agents, workflows, and tools.
            </p>
            {providers.length === 0 && (
              <p className="chat-section-welcome-sub" style={{ marginTop: "0.5rem" }}>
                <a href="/settings/llm" className="chat-section-settings-link">
                  Add an LLM provider
                </a>{" "}
                in Settings to start chatting.
              </p>
            )}
          </div>
        ) : (
          <div className="chat-section-message-list">
            {messages.map((msg, index) => (
              <ChatSectionMessageRow
                key={msg.id}
                msg={msg}
                index={index}
                messages={messages}
                loading={loading}
                collapsedStepsByMsg={collapsedStepsByMsg}
                setCollapsedStepsByMsg={setCollapsedStepsByMsg}
                copiedMsgId={copiedMsgId}
                setCopiedMsgId={setCopiedMsgId}
                openMessageFeedback={openMessageFeedback}
                feedbackLabel={
                  msg.role === "assistant"
                    ? (feedbackByContentKey[
                        feedbackContentKey(
                          (messages[index - 1] as Message | undefined)?.content ?? "",
                          msg.content
                        )
                      ] ?? null)
                    : null
                }
                send={send}
                providerId={providerId}
                conversationId={conversationId}
                getMessageCopyText={getMessageCopyText}
                onShellCommandApprove={handleShellCommandApprove}
                onShellCommandAddToAllowlist={handleShellCommandAddToAllowlist}
                shellCommandLoading={shellCommandLoading}
                optionSending={optionSending}
                setOptionSending={setOptionSending}
              />
            ))}
            {runWaiting && runWaitingData && (
              <AgentRequestBlock
                question={runWaitingData.question}
                options={runWaitingData.options}
                runId={runWaitingData.runId}
                viewRunHref={runWaitingData.runId ? `/runs/${runWaitingData.runId}` : undefined}
                sendingOption={runWaitingOptionSending}
                onReplyOption={(value) => {
                  setRunWaitingOptionSending(value);
                  send(value);
                }}
                onCancelRun={onCancelRun}
                showVagueHint
              />
            )}
          </div>
        )}
      </div>

      {(() => {
        const statusBarShow = messages.length > 0 && loading && lastMsg?.role === "assistant";
        if (!statusBarShow) return null;
        const status = getLoadingStatus(
          lastMsg as Message & {
            traceSteps?: { phase: string; label?: string }[];
            todos?: string[];
            completedStepIndices?: number[];
            executingStepIndex?: number;
            executingToolName?: string;
            executingSubStepLabel?: string;
            reasoning?: string;
          }
        );
        return (
          <div className="chat-section-status-bar" aria-live="polite" key="chat-status-bar">
            <LogoLoading size={18} className="chat-section-status-bar-logo" />
            <span className="chat-section-status-bar-status">{status}</span>
            {conversationId && (
              <a
                href={`/queues?conversation=${encodeURIComponent(conversationId)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="chat-section-status-bar-queue-link"
                title="View queue and steps for this conversation"
              >
                Queue
              </a>
            )}
          </div>
        );
      })()}

      {providers.length === 0 && (
        <div className="chat-section-no-model-banner">
          No model selected.{" "}
          <a href="/settings/llm" className="chat-section-settings-link">
            Add an LLM provider in Settings
          </a>{" "}
          to send messages.
        </div>
      )}
      <div className="chat-section-input-bar">
        <div className="chat-section-input-field-wrap">
          <textarea
            ref={inputRef}
            className="chat-section-input chat-section-input-textarea"
            placeholder="Message Agentron… (Shift+Enter for new line)"
            value={input}
            onChange={(e) => {
              lastLocalInputChangeAtRef.current = Date.now();
              setInput(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            onInput={resizeInput}
            rows={1}
          />
          <div className="chat-section-input-controls">
            <StyledSelect
              value={providerId}
              options={
                providers.length === 0
                  ? [{ value: "", label: "Add model" }]
                  : [...providers]
                      .sort(
                        (a, b) =>
                          a.model.localeCompare(b.model, undefined, { sensitivity: "base" }) ||
                          a.provider.localeCompare(b.provider)
                      )
                      .map((p) => ({
                        value: p.id,
                        label: p.model,
                        title: `${p.model} (${p.provider})`,
                      }))
              }
              onChange={(value) =>
                handleProviderChange({ target: { value } } as React.ChangeEvent<HTMLSelectElement>)
              }
              leftIcon={<Sparkles size={16} className="chat-section-dropdown-icon" />}
              placeholder="Add model"
              aria-label="Model"
              className="chat-section-dropdown-pill"
              triggerClassName="chat-section-dropdown-pill-trigger"
              variant="pill"
              iconOnly
            />
            <StyledSelect
              value={chatMode}
              options={[
                { value: "traditional", label: "Traditional" },
                { value: "heap", label: "Heap" },
              ]}
              onChange={(value) => handleChatModeChange(value as "traditional" | "heap")}
              leftIcon={
                chatMode === "heap" ? (
                  <Network size={16} className="chat-section-dropdown-icon" />
                ) : (
                  <Bot size={16} className="chat-section-dropdown-icon" />
                )
              }
              aria-label="Mode"
              className="chat-section-dropdown-pill chat-section-dropdown-pill-mode"
              triggerClassName="chat-section-dropdown-pill-trigger"
              variant="pill"
              iconOnly
            />
            <button
              type="button"
              className="chat-section-feedback-btn"
              onClick={() => setShowFeedbackModal(true)}
              title="Feedback"
              aria-label="Feedback"
            >
              <Star size={16} />
            </button>
            {loading ? (
              <button
                type="button"
                className="chat-section-send"
                onClick={stopRequest}
                title="Stop"
              >
                <Square size={18} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                className="chat-section-send"
                onClick={() => void send()}
                disabled={!input.trim() || !providerId}
                title={!providerId ? "Select a model" : "Send"}
              >
                <ArrowUp size={18} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
