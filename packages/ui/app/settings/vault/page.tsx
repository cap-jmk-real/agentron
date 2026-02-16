"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { Lock, Unlock, Trash2, Pencil, Upload } from "lucide-react";
import ConfirmModal from "../../components/confirm-modal";

type VaultStatus = { locked: boolean; vaultExists: boolean };
type CredentialKey = { key: string; createdAt: number };

export default function VaultSettingsPage() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [keys, setKeys] = useState<CredentialKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [masterPassword, setMasterPassword] = useState("");
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [vaultLoading, setVaultLoading] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [clearModal, setClearModal] = useState(false);
  const [clearLoading, setClearLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; errors?: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchStatus = () =>
    fetch("/api/vault/status", { credentials: "include" })
      .then((r) => r.json())
      .then((data: VaultStatus) => setStatus(data))
      .catch(() => setStatus(null));

  const fetchKeys = () =>
    fetch("/api/vault/credentials", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { keys: [] }))
      .then((data: { keys: CredentialKey[] }) => setKeys(data.keys ?? []))
      .catch(() => setKeys([]));

  useEffect(() => {
    Promise.all([fetchStatus(), fetchKeys()]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (status?.vaultExists && !status?.locked) fetchKeys();
  }, [status?.vaultExists, status?.locked]);

  const handleCreateOrUnlock = async () => {
    if (!masterPassword.trim()) return;
    setVaultLoading(true);
    setVaultError(null);
    try {
      const endpoint = status?.vaultExists ? "/api/vault/unlock" : "/api/vault/create";
      const res = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ masterPassword: masterPassword.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setVaultError(data.error ?? "Failed");
        return;
      }
      setMasterPassword("");
      await fetchStatus();
      if (status?.vaultExists) await fetchKeys();
    } catch {
      setVaultError("Request failed");
    } finally {
      setVaultLoading(false);
    }
  };

  const handleLock = async () => {
    setVaultLoading(true);
    try {
      await fetch("/api/vault/lock", { method: "POST", credentials: "include" });
      await fetchStatus();
      setKeys([]);
    } finally {
      setVaultLoading(false);
    }
  };

  const handleDelete = async (key: string) => {
    const res = await fetch(`/api/vault/credentials/${encodeURIComponent(key)}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) fetchKeys();
  };

  const handleEditSave = async () => {
    if (!editingKey || editValue.trim() === "") return;
    setEditSaving(true);
    try {
      const res = await fetch(`/api/vault/credentials/${encodeURIComponent(editingKey)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: editValue.trim() }),
      });
      if (res.ok) {
        setEditingKey(null);
        setEditValue("");
        fetchKeys();
      }
    } finally {
      setEditSaving(false);
    }
  };

  const handleClearVault = async () => {
    setClearLoading(true);
    try {
      const res = await fetch("/api/vault/credentials/clear", {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        setClearModal(false);
        fetchKeys();
      }
    } finally {
      setClearLoading(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportLoading(true);
    setImportResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/vault/credentials/import", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const data = await res.json();
      if (res.ok) {
        setImportResult({ imported: data.imported ?? 0, errors: data.errors });
        fetchKeys();
      } else {
        setImportResult({ imported: 0, errors: [data.error ?? "Import failed"] });
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch {
      setImportResult({ imported: 0, errors: ["Request failed"] });
    } finally {
      setImportLoading(false);
    }
  };

  if (loading || status === null) {
    return (
      <div style={{ maxWidth: 680 }}>
        <p style={{ color: "var(--text-muted)" }}>Loading…</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 680 }}>
      <h1 style={{ margin: "0 0 0.25rem" }}>Vault</h1>
      <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0 0 1.5rem" }}>
        Store API keys and passwords used by the chat agent. Data is encrypted with a master password. Unlock the vault in Chat to let the agent use saved credentials.
      </p>

      {!status.vaultExists && (
        <div className="card" style={{ padding: "1rem" }}>
          <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <Lock size={16} /> Create vault
          </div>
          <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0 0 0.75rem" }}>
            Set a master password. You will need it to unlock the vault and manage stored credentials.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: 320 }}>
            <input
              type="password"
              placeholder="Master password"
              value={masterPassword}
              onChange={(e) => { setMasterPassword(e.target.value); setVaultError(null); }}
              onKeyDown={(e) => e.key === "Enter" && handleCreateOrUnlock()}
              style={{ padding: "0.5rem 0.6rem", fontSize: "0.9rem" }}
              aria-label="Master password"
            />
            <button
              type="button"
              className="button"
              disabled={vaultLoading || !masterPassword.trim()}
              onClick={handleCreateOrUnlock}
            >
              {vaultLoading ? "…" : "Create vault"}
            </button>
            {vaultError && <span style={{ fontSize: "0.82rem", color: "#dc2626" }}>{vaultError}</span>}
          </div>
        </div>
      )}

      {status.vaultExists && status.locked && (
        <div className="card" style={{ padding: "1rem" }}>
          <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <Lock size={16} /> Vault locked
          </div>
          <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0 0 0.75rem" }}>
            Enter your master password to view and manage stored credentials.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: 320 }}>
            <input
              type="password"
              placeholder="Master password"
              value={masterPassword}
              onChange={(e) => { setMasterPassword(e.target.value); setVaultError(null); }}
              onKeyDown={(e) => e.key === "Enter" && handleCreateOrUnlock()}
              style={{ padding: "0.5rem 0.6rem", fontSize: "0.9rem" }}
              aria-label="Master password"
            />
            <button
              type="button"
              className="button"
              disabled={vaultLoading || !masterPassword.trim()}
              onClick={handleCreateOrUnlock}
            >
              {vaultLoading ? "…" : "Unlock"}
            </button>
            {vaultError && <span style={{ fontSize: "0.82rem", color: "#dc2626" }}>{vaultError}</span>}
          </div>
        </div>
      )}

      {status.vaultExists && !status.locked && (
        <>
          <div className="card" style={{ padding: "1rem", marginBottom: "0.75rem" }}>
            <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <Unlock size={16} /> Vault unlocked
            </div>
            <button
              type="button"
              className="button button-ghost button-small"
              disabled={vaultLoading}
              onClick={handleLock}
            >
              Lock vault
            </button>
          </div>

          <div className="card" style={{ padding: "1rem" }}>
            <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.75rem" }}>Stored credentials</div>
            <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0 0 0.75rem" }}>
              Credential names (keys) only; values are never shown here. Edit to change the stored value, or delete to remove.
            </p>
            {keys.length === 0 ? (
              <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: 0 }}>No credentials stored yet. Save them from Chat when the agent asks, or import from CSV below.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 1rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                {keys.map(({ key }) => (
                  <li
                    key={key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "0.5rem",
                      padding: "0.5rem 0.6rem",
                      background: "var(--surface-muted)",
                      borderRadius: 6,
                    }}
                  >
                    <code style={{ fontSize: "0.82rem", wordBreak: "break-all" }}>{key}</code>
                    <div style={{ display: "flex", gap: "0.35rem", flexShrink: 0 }}>
                      <button
                        type="button"
                        className="button button-ghost button-small"
                        title="Edit value"
                        onClick={() => { setEditingKey(key); setEditValue(""); }}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        className="button button-ghost button-small"
                        title="Delete"
                        style={{ color: "var(--danger, #ef4444)" }}
                        onClick={() => handleDelete(key)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {editingKey && (
              <div style={{ padding: "0.75rem", background: "var(--surface-muted)", borderRadius: 6, marginBottom: "1rem" }}>
                <div style={{ fontSize: "0.82rem", fontWeight: 600, marginBottom: "0.35rem" }}>New value for {editingKey}</div>
                <input
                  type="password"
                  placeholder="New value"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  style={{ width: "100%", padding: "0.5rem 0.6rem", fontSize: "0.9rem", marginBottom: "0.5rem" }}
                  aria-label="New value"
                />
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button type="button" className="button button-small" disabled={editSaving || !editValue.trim()} onClick={handleEditSave}>
                    {editSaving ? "Saving…" : "Save"}
                  </button>
                  <button type="button" className="button button-ghost button-small" onClick={() => { setEditingKey(null); setEditValue(""); }} disabled={editSaving}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div style={{ paddingTop: "1rem", borderTop: "1px solid var(--border)" }}>
              <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <Upload size={16} /> Import from CSV
              </div>
              <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0 0 0.5rem" }}>
                CSV with columns like <code>key,value</code> or <code>name,password</code>. First row can be a header.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv,application/json"
                style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
                onChange={handleImport}
              />
              <button
                type="button"
                className="button button-ghost button-small"
                disabled={importLoading}
                onClick={() => fileInputRef.current?.click()}
              >
                {importLoading ? "Importing…" : "Choose CSV or JSON file"}
              </button>
              {importResult && (
                <div style={{ marginTop: "0.5rem", fontSize: "0.82rem" }}>
                  <span style={{ color: "#22c55e", fontWeight: 500 }}>Imported {importResult.imported} credential(s).</span>
                  {importResult.errors && importResult.errors.length > 0 && (
                    <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.25rem", color: "var(--text-muted)" }}>
                      {importResult.errors.slice(0, 5).map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                      {importResult.errors.length > 5 && <li>…and {importResult.errors.length - 5} more</li>}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--border)" }}>
              <button
                type="button"
                className="button button-ghost"
                onClick={() => setClearModal(true)}
                style={{ color: "#dc2626", fontSize: "0.85rem" }}
                disabled={keys.length === 0}
              >
                <Trash2 size={14} /> Clear all credentials
              </button>
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0.35rem 0 0", lineHeight: 1.4 }}>
                Remove every stored credential. The vault (master password) stays; you can create a new vault only by resetting the database.
              </p>
            </div>
          </div>
        </>
      )}

      <ConfirmModal
        open={clearModal}
        title="Clear all credentials"
        message="Remove every credential from the vault? This cannot be undone."
        confirmLabel="Clear all"
        cancelLabel="Cancel"
        danger
        loading={clearLoading}
        onConfirm={handleClearVault}
        onCancel={() => !clearLoading && setClearModal(false)}
      />

      <p style={{ marginTop: "1rem", fontSize: "0.82rem", color: "var(--text-muted)" }}>
        <Link href="/settings" style={{ color: "var(--primary)" }}>← General settings</Link>
      </p>
    </div>
  );
}
