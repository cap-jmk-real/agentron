"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { Lock, Unlock, Trash2, Pencil, Upload, Plus } from "lucide-react";
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
  const [editSaving, setEditSaving] = useState(false);
  const [clearModal, setClearModal] = useState(false);
  const [clearLoading, setClearLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; errors?: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newWebsite, setNewWebsite] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [editWebsite, setEditWebsite] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editPassword, setEditPassword] = useState("");

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
    if (!editingKey || !editPassword.trim()) return;
    setEditSaving(true);
    try {
      const value = JSON.stringify({
        website: editWebsite.trim(),
        username: editUsername.trim(),
        password: editPassword.trim(),
      });
      const res = await fetch(`/api/vault/credentials/${encodeURIComponent(editingKey)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (res.ok) {
        setEditingKey(null);
        setEditWebsite("");
        setEditUsername("");
        setEditPassword("");
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

  /** Derive storage key from website (e.g. "LinkedIn" → "linkedin"). */
  const websiteToKey = (website: string) =>
    website.trim().toLowerCase().replace(/\s+/g, "_") || "";

  const handleAddCredential = async () => {
    const key = websiteToKey(newWebsite);
    if (!key) {
      setAddError("Website is required.");
      return;
    }
    if (!newPassword.trim()) {
      setAddError("Password is required.");
      return;
    }
    const value = JSON.stringify({
      website: newWebsite.trim(),
      username: newUsername.trim(),
      password: newPassword.trim(),
    });
    setAddSaving(true);
    setAddError(null);
    try {
      const res = await fetch(`/api/vault/credentials/${encodeURIComponent(key)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      const data = await res.json();
      if (res.ok) {
        setNewWebsite("");
        setNewUsername("");
        setNewPassword("");
        setShowAddForm(false);
        fetchKeys();
      } else {
        setAddError(data.error ?? "Failed to save credential.");
      }
    } catch {
      setAddError("Request failed.");
    } finally {
      setAddSaving(false);
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
          <div className="form-group" style={{ maxWidth: 320 }}>
            <input
              type="password"
              className="input"
              placeholder="Master password"
              value={masterPassword}
              onChange={(e) => { setMasterPassword(e.target.value); setVaultError(null); }}
              onKeyDown={(e) => e.key === "Enter" && handleCreateOrUnlock()}
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
          <div className="form-group" style={{ maxWidth: 320 }}>
            <input
              type="password"
              className="input"
              placeholder="Master password"
              value={masterPassword}
              onChange={(e) => { setMasterPassword(e.target.value); setVaultError(null); }}
              onKeyDown={(e) => e.key === "Enter" && handleCreateOrUnlock()}
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
            <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.75rem", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
              Stored credentials
              {!showAddForm && (
                <button
                  type="button"
                  className="button button-small"
                  onClick={() => { setShowAddForm(true); setAddError(null); setNewWebsite(""); setNewUsername(""); setNewPassword(""); }}
                >
                  <Plus size={14} /> Add credential
                </button>
              )}
            </div>
            <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0 0 0.75rem" }}>
              Each credential stores website, username/email, and password. The key is derived from the website (e.g. linkedin). Add a new one or edit/delete existing.
            </p>

            {showAddForm && (
              <div style={{ padding: "0.75rem", background: "var(--surface-muted)", borderRadius: 10, marginBottom: "1rem" }}>
                <div style={{ fontSize: "0.82rem", fontWeight: 600, marginBottom: "0.5rem" }}>New credential</div>
                <div className="form-group">
                  <input
                    type="text"
                    className="input"
                    placeholder="Website (e.g. LinkedIn, Gmail)"
                    value={newWebsite}
                    onChange={(e) => { setNewWebsite(e.target.value); setAddError(null); }}
                    aria-label="Website"
                  />
                  <input
                    type="text"
                    className="input"
                    autoComplete="username"
                    placeholder="Username or email"
                    value={newUsername}
                    onChange={(e) => { setNewUsername(e.target.value); setAddError(null); }}
                    aria-label="Username or email"
                  />
                  <input
                    type="password"
                    className="input"
                    autoComplete="current-password"
                    placeholder="Password"
                    value={newPassword}
                    onChange={(e) => { setNewPassword(e.target.value); setAddError(null); }}
                    aria-label="Password"
                  />
                </div>
                {addError && <p style={{ fontSize: "0.82rem", color: "#dc2626", margin: "0 0 0.5rem" }}>{addError}</p>}
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button type="button" className="button button-small" disabled={addSaving || !websiteToKey(newWebsite) || !newPassword.trim()} onClick={handleAddCredential}>
                    {addSaving ? "Saving…" : "Save"}
                  </button>
                  <button type="button" className="button button-ghost button-small" onClick={() => { setShowAddForm(false); setNewWebsite(""); setNewUsername(""); setNewPassword(""); setAddError(null); }} disabled={addSaving}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {keys.length === 0 && !showAddForm ? (
              <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: 0 }}>No credentials stored yet. Add one above, save from Chat when the agent asks, or import from CSV below.</p>
            ) : keys.length > 0 ? (
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
                        title="Edit credential"
                        onClick={() => { setEditingKey(key); setEditWebsite(""); setEditUsername(""); setEditPassword(""); }}
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
            ) : null}

            {editingKey && (
              <div style={{ padding: "0.75rem", background: "var(--surface-muted)", borderRadius: 10, marginBottom: "1rem" }}>
                <div style={{ fontSize: "0.82rem", fontWeight: 600, marginBottom: "0.35rem" }}>Edit credential: {editingKey}</div>
                <div className="form-group">
                  <input
                    type="text"
                    className="input"
                    placeholder="Website (e.g. LinkedIn)"
                    value={editWebsite}
                    onChange={(e) => setEditWebsite(e.target.value)}
                    aria-label="Website"
                  />
                  <input
                    type="text"
                    className="input"
                    autoComplete="username"
                    placeholder="Username or email"
                    value={editUsername}
                    onChange={(e) => setEditUsername(e.target.value)}
                    aria-label="Username or email"
                  />
                  <input
                    type="password"
                    className="input"
                    autoComplete="current-password"
                    placeholder="Password"
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    aria-label="Password"
                  />
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button type="button" className="button button-small" disabled={editSaving || !editPassword.trim()} onClick={handleEditSave}>
                    {editSaving ? "Saving…" : "Save"}
                  </button>
                  <button type="button" className="button button-ghost button-small" onClick={() => { setEditingKey(null); setEditWebsite(""); setEditUsername(""); setEditPassword(""); }} disabled={editSaving}>
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
