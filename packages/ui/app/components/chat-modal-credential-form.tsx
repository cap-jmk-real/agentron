"use client";

import { KeyRound } from "lucide-react";

export type ChatModalCredentialFormProps = {
  credentialInput: string;
  setCredentialInput: (v: string) => void;
  credentialSave: boolean;
  setCredentialSave: (v: boolean) => void;
  vaultLocked: boolean;
  question: string;
  credentialKey: string;
  onSubmit: (payload: { credentialKey: string; value: string; save: boolean }) => void;
};

export function ChatModalCredentialForm({
  credentialInput,
  setCredentialInput,
  credentialSave,
  setCredentialSave,
  vaultLocked,
  question,
  credentialKey,
  onSubmit,
}: ChatModalCredentialFormProps) {
  return (
    <div className="chat-credential-form" aria-label="Enter credential securely">
      <p className="chat-credential-prompt">{question}</p>
      <div className="chat-credential-fields">
        <KeyRound size={16} className="chat-credential-icon" aria-hidden />
        <input
          type="password"
          className="chat-credential-input"
          placeholder="Enter value (never shown in chat)"
          value={credentialInput}
          onChange={(e) => setCredentialInput(e.target.value)}
          autoComplete="off"
          aria-label="Credential value"
        />
      </div>
      <label
        className="chat-credential-save-label"
        title={vaultLocked ? "Unlock the vault above to save credentials" : undefined}
      >
        <input
          type="checkbox"
          checked={credentialSave}
          onChange={(e) => setCredentialSave(e.target.checked)}
          disabled={vaultLocked}
          className="chat-credential-save-checkbox"
        />
        <span>Save for future use{vaultLocked ? " (unlock vault first)" : ""}</span>
      </label>
      <button
        type="button"
        className="chat-credential-submit"
        disabled={!credentialInput.trim()}
        onClick={() => {
          const value = credentialInput.trim();
          if (!value) return;
          setCredentialInput("");
          setCredentialSave(false);
          onSubmit({ credentialKey, value, save: credentialSave });
        }}
      >
        Submit
      </button>
    </div>
  );
}
