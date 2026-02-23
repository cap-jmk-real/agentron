"use client";

import {
  Minus,
  ArrowUp,
  Square,
  MessageSquarePlus,
  List,
  Star,
  GitBranch,
  Sparkles,
  Bot,
  Network,
} from "lucide-react";
import { StyledSelect } from "./styled-select";
import { getLoadingStatus } from "./chat-message-content";
import LogoLoading from "./logo-loading";
import BrandIcon from "./brand-icon";
import { AgentRequestBlock } from "./agent-request-block";
import { ChatModalMessageRow } from "./chat-modal-message-row";
import { ChatModalVaultBar } from "./chat-modal-vault-bar";
import { ChatModalCredentialForm } from "./chat-modal-credential-form";
import type { Message } from "./chat-types";

export type LlmProvider = { id: string; provider: string; model: string; endpoint?: string };

export type ChatModalMainProps = {
  embedded: boolean;
  attachedContext?: string | null;
  showConversationList: boolean;
  setShowConversationList: React.Dispatch<React.SetStateAction<boolean>>;
  startNewChat: () => void;
  conversationId: string | null;
  onClose: () => void;
  vaultLocked: boolean;
  vaultExists: boolean;
  vaultPassword: string;
  vaultError: string | null;
  vaultLoading: boolean;
  showVaultForm: boolean;
  setShowVaultForm: React.Dispatch<React.SetStateAction<boolean>>;
  setVaultPassword: React.Dispatch<React.SetStateAction<string>>;
  setVaultError: React.Dispatch<React.SetStateAction<string | null>>;
  onVaultUnlock: () => Promise<void>;
  onVaultLock: () => Promise<void>;
  lockVaultBtnRef: React.RefObject<HTMLButtonElement | null>;
  messages: Message[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  providers: LlmProvider[];
  loading: boolean;
  lastMsg: Message | undefined;
  runWaiting: boolean;
  runWaitingData: { runId: string; question?: string; options?: string[] } | null;
  send: (
    payload?: unknown,
    optionValue?: string,
    extraBody?: Record<string, unknown>
  ) => Promise<void>;
  credentialInput: string;
  setCredentialInput: React.Dispatch<React.SetStateAction<string>>;
  credentialSave: boolean;
  setCredentialSave: React.Dispatch<React.SetStateAction<boolean>>;
  providerId: string;
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
  feedbackContentKey: (prev: string, out: string) => string;
  setCopiedMsgId: React.Dispatch<React.SetStateAction<string | null>>;
  copiedMsgId: string | null;
  openMessageFeedback: (msg: Message, label: "good" | "bad") => void;
  feedbackByContentKey: Record<string, "good" | "bad">;
  handleShellCommandApprove: (command: string) => Promise<void>;
  handleShellCommandAddToAllowlist: (command: string) => Promise<void>;
  shellCommandLoading: boolean;
  optionSending: { messageId: string; label: string } | null;
  setOptionSending: React.Dispatch<
    React.SetStateAction<{ messageId: string; label: string } | null>
  >;
  runWaitingOptionSending: string | null;
  setRunWaitingOptionSending: React.Dispatch<React.SetStateAction<string | null>>;
  setRunWaiting: (v: boolean) => void;
  setRunWaitingData: (v: { runId: string; question?: string; options?: string[] } | null) => void;
  setRunWaitingInCache: (
    conversationId: string,
    data: { runId: string; question?: string; options?: string[] } | null
  ) => void;
  setLoading: (v: boolean) => void;
  getMessageCopyText: (msg: Message) => string;
};

export function ChatModalMain(props: ChatModalMainProps) {
  const {
    embedded,
    attachedContext,
    showConversationList,
    setShowConversationList,
    startNewChat,
    conversationId,
    onClose,
    vaultLocked,
    vaultExists,
    vaultPassword,
    vaultError,
    vaultLoading,
    showVaultForm,
    setShowVaultForm,
    setVaultPassword,
    setVaultError,
    onVaultUnlock,
    onVaultLock,
    lockVaultBtnRef,
    messages,
    scrollRef,
    providers,
    loading,
    lastMsg,
    runWaiting,
    runWaitingData,
    send,
    credentialInput,
    setCredentialInput,
    credentialSave,
    setCredentialSave,
    providerId,
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
    feedbackContentKey,
    setCopiedMsgId,
    copiedMsgId,
    openMessageFeedback,
    feedbackByContentKey,
    handleShellCommandApprove,
    handleShellCommandAddToAllowlist,
    shellCommandLoading,
    optionSending,
    setOptionSending,
    runWaitingOptionSending,
    setRunWaitingOptionSending,
    setRunWaiting,
    setRunWaitingData,
    setRunWaitingInCache,
    setLoading,
    getMessageCopyText,
  } = props;

  return (
    <div className={`chat-main ${embedded ? "chat-main-embedded" : ""}`}>
      <div className="chat-header">
        <button
          type="button"
          className="chat-header-btn"
          onClick={() => setShowConversationList((s) => !s)}
          title={showConversationList ? "Close history" : "Chat history"}
        >
          <List size={14} />
        </button>
        <button
          type="button"
          className="chat-header-btn"
          onClick={startNewChat}
          title="New chat"
          aria-label="New chat"
        >
          <MessageSquarePlus size={14} />
        </button>
        <a
          href={
            conversationId
              ? `/chat/traces?conversationId=${encodeURIComponent(conversationId)}`
              : "/chat/traces"
          }
          target="_blank"
          rel="noopener noreferrer"
          className="chat-header-btn"
          title="Open stack trace for this chat"
          aria-label="Open stack trace"
        >
          <GitBranch size={14} />
        </a>
        <div className="chat-header-title">
          <div className="chat-header-dot" />
          <span>Agentron</span>
        </div>
        {!embedded && (
          <button
            className="chat-header-btn chat-header-minimize"
            onClick={onClose}
            title="Minimize"
          >
            <Minus size={14} />
          </button>
        )}
      </div>

      {attachedContext && (
        <div className="chat-attached-banner">
          Run output attached — ask anything and the assistant will use it to help.
        </div>
      )}

      <ChatModalVaultBar
        vaultLocked={vaultLocked}
        vaultExists={vaultExists}
        vaultPassword={vaultPassword}
        vaultError={vaultError}
        vaultLoading={vaultLoading}
        showVaultForm={showVaultForm}
        setShowVaultForm={setShowVaultForm}
        setVaultPassword={setVaultPassword}
        setVaultError={setVaultError}
        onVaultUnlock={onVaultUnlock}
        onVaultLock={onVaultLock}
        lockVaultBtnRef={lockVaultBtnRef}
      />

      <div className="chat-messages" ref={scrollRef}>
        <div className="chat-messages-content">
          {messages.length === 0 && (
            <div className="chat-empty">
              <div className="chat-empty-icon">
                <BrandIcon size={48} />
              </div>
              <p className="chat-empty-title">How can I help?</p>
              <p className="chat-empty-sub">
                Create agents, write functions, manage sandboxes, and more.
              </p>
              {providers.length === 0 && (
                <p className="chat-empty-sub" style={{ marginTop: "0.5rem" }}>
                  <a href="/settings/llm" className="chat-settings-link">
                    Add an LLM provider
                  </a>{" "}
                  in Settings to start chatting.
                </p>
              )}
            </div>
          )}
          {messages.map((msg, index) => (
            <ChatModalMessageRow
              key={msg.id}
              msg={msg}
              index={index}
              messages={messages}
              loading={loading}
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
                send(undefined, value);
              }}
              onCancelRun={async () => {
                if (!runWaitingData?.runId) return;
                try {
                  await fetch(`/api/runs/${encodeURIComponent(runWaitingData.runId)}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ status: "cancelled", finishedAt: Date.now() }),
                  });
                  setRunWaiting(false);
                  setRunWaitingData(null);
                  if (conversationId) setRunWaitingInCache(conversationId, null);
                  setLoading(false);
                } catch {
                  // ignore
                }
              }}
              showVagueHint
            />
          )}
        </div>
        {(() => {
          const askCreds =
            lastMsg?.role === "assistant" && lastMsg.toolResults
              ? lastMsg.toolResults.find(
                  (r) =>
                    r.name === "ask_credentials" &&
                    r.result &&
                    typeof r.result === "object" &&
                    (r.result as { credentialRequest?: boolean }).credentialRequest === true
                )
              : undefined;
          const pendingCredential =
            !loading && askCreds?.result && typeof askCreds.result === "object"
              ? {
                  question:
                    (askCreds.result as { question?: string }).question ?? "Enter credential",
                  credentialKey:
                    (askCreds.result as { credentialKey?: string }).credentialKey ?? "credential",
                }
              : null;
          if (!pendingCredential) return null;
          return (
            <ChatModalCredentialForm
              credentialInput={credentialInput}
              setCredentialInput={setCredentialInput}
              credentialSave={credentialSave}
              setCredentialSave={setCredentialSave}
              vaultLocked={vaultLocked}
              question={pendingCredential.question}
              credentialKey={pendingCredential.credentialKey}
              onSubmit={(payload) => send(payload)}
            />
          );
        })()}
      </div>

      {messages.length > 0 &&
        loading &&
        lastMsg?.role === "assistant" &&
        (() => {
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
            <div className="chat-status-bar" aria-live="polite" key="chat-status-bar">
              <LogoLoading size={18} className="chat-status-bar-logo" />
              <span className="chat-status-bar-status">{status}</span>
              {conversationId && (
                <a
                  href={`/queues?conversation=${encodeURIComponent(conversationId)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="chat-status-bar-queue-link"
                  title="View queue and steps for this conversation"
                >
                  Queue
                </a>
              )}
            </div>
          );
        })()}

      {providers.length === 0 && (
        <div className="chat-no-model-banner">
          No model selected.{" "}
          <a href="/settings/llm" className="chat-settings-link">
            Add an LLM provider in Settings
          </a>{" "}
          to send messages.
        </div>
      )}
      <div className="chat-input-bar">
        <div className="chat-input-field-wrap">
          <textarea
            ref={inputRef}
            className="chat-input chat-input-textarea"
            placeholder="Message…"
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
          <div className="chat-input-controls">
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
              leftIcon={<Sparkles size={16} className="chat-dropdown-icon" />}
              placeholder="Add model"
              aria-label="Model"
              className="chat-dropdown-pill"
              triggerClassName="chat-dropdown-pill-trigger"
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
                  <Network size={16} className="chat-dropdown-icon" />
                ) : (
                  <Bot size={16} className="chat-dropdown-icon" />
                )
              }
              aria-label="Mode"
              className="chat-dropdown-pill chat-dropdown-pill-mode"
              triggerClassName="chat-dropdown-pill-trigger"
              variant="pill"
              iconOnly
            />
            <button
              type="button"
              className="chat-feedback-trigger"
              onClick={() => setShowFeedbackModal(true)}
              title="Feedback"
              aria-label="Feedback"
            >
              <Star size={16} />
            </button>
            {loading ? (
              <button type="button" className="chat-stop-btn" onClick={stopRequest} title="Stop">
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button
                className="chat-send-btn"
                onClick={() => send()}
                disabled={!input.trim() || !providerId}
                title={!providerId ? "Select an LLM provider first" : undefined}
              >
                <ArrowUp size={16} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
