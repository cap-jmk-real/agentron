"use client";

import { Lock, Unlock } from "lucide-react";

export type ChatModalVaultBarProps = {
  vaultLocked: boolean;
  vaultExists: boolean;
  vaultPassword: string;
  vaultError: string | null;
  vaultLoading: boolean;
  showVaultForm: boolean;
  setShowVaultForm: (v: boolean) => void;
  setVaultPassword: (v: string) => void;
  setVaultError: (v: string | null) => void;
  onVaultUnlock: () => void;
  onVaultLock: () => void;
  lockVaultBtnRef: React.RefObject<HTMLButtonElement | null>;
};

export function ChatModalVaultBar({
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
}: ChatModalVaultBarProps) {
  return (
    <div className="chat-vault-bar">
      {vaultLocked ? (
        <>
          <Lock size={14} className="chat-vault-icon" aria-hidden />
          <span className="chat-vault-label">Vault locked — saved credentials unavailable</span>
          {!showVaultForm ? (
            <button type="button" className="chat-vault-btn" onClick={() => setShowVaultForm(true)}>
              {vaultExists ? "Unlock" : "Create vault"}
            </button>
          ) : (
            <div className="chat-vault-form">
              <input
                type="password"
                className="chat-vault-input"
                placeholder={vaultExists ? "Master password" : "Choose master password"}
                value={vaultPassword}
                onChange={(e) => {
                  setVaultPassword(e.target.value);
                  setVaultError(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && onVaultUnlock()}
                aria-label="Vault master password"
              />
              <button
                type="button"
                className="chat-vault-btn"
                onClick={onVaultUnlock}
                disabled={vaultLoading || !vaultPassword.trim()}
              >
                {vaultLoading ? "…" : vaultExists ? "Unlock" : "Create"}
              </button>
              <button
                type="button"
                className="chat-vault-btn chat-vault-btn-ghost"
                onClick={() => {
                  setShowVaultForm(false);
                  setVaultPassword("");
                  setVaultError(null);
                }}
              >
                Cancel
              </button>
              {vaultError && <span className="chat-vault-error">{vaultError}</span>}
            </div>
          )}
        </>
      ) : (
        <>
          <Unlock size={14} className="chat-vault-icon chat-vault-icon-unlocked" aria-hidden />
          <span className="chat-vault-label">Vault unlocked</span>
          <button
            type="button"
            ref={lockVaultBtnRef}
            className="chat-vault-btn"
            onClick={onVaultLock}
            disabled={vaultLoading}
          >
            Lock vault
          </button>
        </>
      )}
    </div>
  );
}
