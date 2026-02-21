"use client";

import { List, Send, Square, Star, Bot, Network } from "lucide-react";
import { getLoadingStatus } from "./chat-message-content";
import LogoLoading from "./logo-loading";
import BrandIcon from "./brand-icon";
import { AgentRequestBlock } from "./agent-request-block";
import { ChatSectionMessageRow } from "./chat-section-message-row";
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
  runFinishedNotification: { runId: string; status: string } | null;
  setRunFinishedNotification: React.Dispatch<
    React.SetStateAction<{ runId: string; status: string } | null>
  >;
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
    runFinishedNotification,
    setRunFinishedNotification,
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
            <span>{status}</span>
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
      {runFinishedNotification && !loading && (
        <div className="chat-section-run-finished-toast">
          <span>
            {runFinishedNotification.status === "waiting_for_user"
              ? "The agent is waiting for your input. Send a message below to respond."
              : "Workflow run finished. The agent may need your input."}
          </span>
          <a
            href={`/runs/${runFinishedNotification.runId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="chat-section-run-finished-link"
          >
            View run
          </a>
          <button
            type="button"
            className="chat-section-run-finished-dismiss"
            onClick={() => setRunFinishedNotification(null)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
      <div className="chat-section-input-options">
        <select
          className="chat-section-model-select"
          value={providerId}
          onChange={handleProviderChange}
          title="Select model"
          aria-label="Model"
        >
          <option value="">Select model…</option>
          {[...providers]
            .sort(
              (a, b) =>
                a.model.localeCompare(b.model, undefined, { sensitivity: "base" }) ||
                a.provider.localeCompare(b.provider)
            )
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.model} ({p.provider})
              </option>
            ))}
        </select>
        <div className="chat-section-mode-segments" role="group" aria-label="Mode">
          <button
            type="button"
            className={`chat-section-mode-segment${chatMode === "traditional" ? " chat-section-mode-segment-active" : ""}`}
            onClick={() => handleChatModeChange("traditional")}
            title="Traditional: single assistant"
          >
            <Bot size={14} aria-hidden />
            <span>Traditional</span>
          </button>
          <button
            type="button"
            className={`chat-section-mode-segment${chatMode === "heap" ? " chat-section-mode-segment-active" : ""}`}
            onClick={() => handleChatModeChange("heap")}
            title="Heap: multi-agent (router + specialists)"
          >
            <Network size={14} aria-hidden />
            <span>Heap</span>
          </button>
        </div>
      </div>
      <div className="chat-section-input-wrap">
        <div className="chat-section-input-inner">
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
          {loading ? (
            <button type="button" className="chat-section-send" onClick={stopRequest} title="Stop">
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
              <Send size={18} />
            </button>
          )}
        </div>
        <button
          type="button"
          className="chat-section-feedback-btn"
          onClick={() => setShowFeedbackModal(true)}
        >
          <Star size={14} /> Feedback
        </button>
      </div>
    </div>
  );
}
