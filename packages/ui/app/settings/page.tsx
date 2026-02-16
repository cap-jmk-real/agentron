"use client";

import { useState, useEffect, useRef } from "react";
import { Download, Upload, Database, RotateCcw, FileJson, HardDrive, Terminal, Trash2, Plus } from "lucide-react";
import ConfirmModal from "../components/confirm-modal";
import CopyDebugInfoButton from "../components/copy-debug-info-button";
import {
  getSystemStatsIntervalMs,
  setSystemStatsIntervalMs,
  SYSTEM_STATS_INTERVAL_MIN_MS,
  SYSTEM_STATS_INTERVAL_MAX_MS,
  SYSTEM_STATS_INTERVAL_DEFAULT_MS,
  SYSTEM_STATS_INTERVAL_STEP_MS,
  formatSystemStatsInterval,
  SYSTEM_STATS_INTERVAL_CHANGED_EVENT,
} from "../lib/system-stats-interval";

export default function SettingsPage() {
  const [intervalMs, setIntervalMs] = useState(SYSTEM_STATS_INTERVAL_DEFAULT_MS);
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const defImportInputRef = useRef<HTMLInputElement>(null);
  const [defImportOverwrite, setDefImportOverwrite] = useState(false);
  const [defImportResult, setDefImportResult] = useState<Record<string, unknown> | null>(null);
  const [defImportError, setDefImportError] = useState<string | null>(null);
  const [maxFileUploadMb, setMaxFileUploadMb] = useState<number>(50);
  const [maxFileUploadSaving, setMaxFileUploadSaving] = useState(false);
  const [shellAllowlist, setShellAllowlist] = useState<string[]>([]);
  const [shellAllowlistNewCommand, setShellAllowlistNewCommand] = useState("");
  const [shellAllowlistSaving, setShellAllowlistSaving] = useState(false);
  const [workflowMaxSelfFixRetries, setWorkflowMaxSelfFixRetries] = useState<number>(3);
  const [workflowMaxSelfFixSaving, setWorkflowMaxSelfFixSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings/app")
      .then((r) => r.ok ? r.json() : null)
      .then((data: { maxFileUploadBytes?: number; shellCommandAllowlist?: string[]; workflowMaxSelfFixRetries?: number } | null) => {
        if (!data) return;
        if (data.maxFileUploadBytes) setMaxFileUploadMb(Math.round(data.maxFileUploadBytes / (1024 * 1024)));
        if (Array.isArray(data.shellCommandAllowlist)) setShellAllowlist(data.shellCommandAllowlist);
        if (typeof data.workflowMaxSelfFixRetries === "number") setWorkflowMaxSelfFixRetries(data.workflowMaxSelfFixRetries);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setIntervalMs(getSystemStatsIntervalMs());
    const handler = () => setIntervalMs(getSystemStatsIntervalMs());
    window.addEventListener(SYSTEM_STATS_INTERVAL_CHANGED_EVENT, handler);
    return () => window.removeEventListener(SYSTEM_STATS_INTERVAL_CHANGED_EVENT, handler);
  }, []);

  return (
    <div style={{ maxWidth: 680 }}>
      <h1 style={{ margin: "0 0 0.25rem" }}>Settings</h1>
      <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0 0 1.5rem" }}>
        General configuration for AgentOS Studio.
      </p>

      <div className="card" style={{ padding: "1rem" }}>
        <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>System stats refresh</div>
        <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0 0 0.75rem" }}>
          How often CPU, RAM, disk and GPU are polled (sidebar and Statistics → Resources). Background tabs poll every 5 s. 0.2 s – 5 s.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <input
            type="range"
            min={SYSTEM_STATS_INTERVAL_MIN_MS}
            max={SYSTEM_STATS_INTERVAL_MAX_MS}
            step={SYSTEM_STATS_INTERVAL_STEP_MS}
            value={intervalMs}
            onChange={(e) => {
              const v = Number(e.target.value);
              setIntervalMs(v);
              setSystemStatsIntervalMs(v);
            }}
            style={{ flex: "1 1 200px", minWidth: 120, accentColor: "var(--primary)" }}
          />
          <span style={{ fontSize: "0.85rem", fontWeight: 600, minWidth: 52 }}>{formatSystemStatsInterval(intervalMs)}</span>
        </div>
      </div>

      <div className="card" style={{ padding: "1rem", marginTop: "0.75rem" }}>
        <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <HardDrive size={16} /> Max file upload size
        </div>
        <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0 0 0.75rem" }}>
          Maximum size for a single file upload (Files and RAG). 1–500 MB.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <input
            type="number"
            min={1}
            max={500}
            value={maxFileUploadMb}
            onChange={(e) => setMaxFileUploadMb(Number(e.target.value) || 50)}
            style={{ width: 80, padding: "0.35rem 0.5rem", fontSize: "0.9rem" }}
          />
          <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>MB</span>
          <button
            type="button"
            className="button button-ghost button-small"
            disabled={maxFileUploadSaving}
            onClick={async () => {
              setMaxFileUploadSaving(true);
              try {
                const res = await fetch("/api/settings/app", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ maxFileUploadBytes: maxFileUploadMb * 1024 * 1024 }),
                });
                if (res.ok) {
                  const data = await res.json();
                  setMaxFileUploadMb(Math.round((data.maxFileUploadBytes as number) / (1024 * 1024)));
                }
              } finally {
                setMaxFileUploadSaving(false);
              }
            }}
          >
            {maxFileUploadSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: "1rem", marginTop: "0.75rem" }}>
        <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <Terminal size={16} /> Shell command allowlist
        </div>
        <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0 0 0.75rem", lineHeight: 1.5 }}>
          Commands the chat assistant can run without user approval. Useful for trusted commands like <code style={{ fontSize: "0.8em", background: "var(--surface-muted)", padding: "0.1em 0.3em", borderRadius: 4 }}>docker ps</code> or <code style={{ fontSize: "0.8em", background: "var(--surface-muted)", padding: "0.1em 0.3em", borderRadius: 4 }}>podman --version</code>. Add commands that you trust; others will require approval in the chat UI.
        </p>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
          <input
            type="text"
            value={shellAllowlistNewCommand}
            onChange={(e) => setShellAllowlistNewCommand(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), document.getElementById("shell-allowlist-add")?.click())}
            placeholder="e.g. docker ps"
            className="input"
            style={{ flex: "1 1 180px", minWidth: 120 }}
          />
          <button
            id="shell-allowlist-add"
            type="button"
            className="button button-ghost button-small"
            disabled={shellAllowlistSaving || !shellAllowlistNewCommand.trim()}
            onClick={async () => {
              const cmd = shellAllowlistNewCommand.trim();
              if (!cmd || shellAllowlist.includes(cmd)) return;
              setShellAllowlistSaving(true);
              try {
                const res = await fetch("/api/settings/app", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ shellCommandAllowlist: [...shellAllowlist, cmd] }),
                });
                if (res.ok) {
                  setShellAllowlist((prev) => [...prev, cmd]);
                  setShellAllowlistNewCommand("");
                }
              } finally {
                setShellAllowlistSaving(false);
              }
            }}
          >
            <Plus size={14} /> Add
          </button>
        </div>
        {shellAllowlist.length > 0 ? (
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {shellAllowlist.map((cmd) => (
              <li
                key={cmd}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0.4rem 0.5rem",
                  background: "var(--surface-muted)",
                  borderRadius: 6,
                  marginBottom: "0.35rem",
                  fontFamily: "ui-monospace, monospace",
                  fontSize: "0.85rem",
                }}
              >
                <code style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cmd}</code>
                <button
                  type="button"
                  className="button button-ghost button-small"
                  disabled={shellAllowlistSaving}
                  onClick={async () => {
                    const next = shellAllowlist.filter((c) => c !== cmd);
                    setShellAllowlistSaving(true);
                    try {
                      const res = await fetch("/api/settings/app", {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ shellCommandAllowlist: next }),
                      });
                      if (res.ok) setShellAllowlist(next);
                    } finally {
                      setShellAllowlistSaving(false);
                    }
                  }}
                  title="Remove from allowlist"
                  aria-label={`Remove ${cmd}`}
                >
                  <Trash2 size={12} style={{ color: "var(--text-muted)" }} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: 0 }}>
            No commands in allowlist. Commands proposed by the chat will require approval.
          </p>
        )}
      </div>

      <div className="card" style={{ padding: "1rem", marginTop: "0.75rem" }}>
        <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>Workflow self-fix attempts</div>
        <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0 0 0.75rem", lineHeight: 1.5 }}>
          When a workflow agent tool fails and would ask for confirmation to retry, the system can let the agent retry automatically. 0 = off (always pause). 1–10 = max automatic retries before pausing for user input.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <input
            type="number"
            min={0}
            max={10}
            value={workflowMaxSelfFixRetries}
            onChange={(e) => setWorkflowMaxSelfFixRetries(Math.min(10, Math.max(0, Number(e.target.value) || 0)))}
            style={{ width: 64, padding: "0.35rem 0.5rem", fontSize: "0.9rem" }}
          />
          <button
            type="button"
            className="button button-ghost button-small"
            disabled={workflowMaxSelfFixSaving}
            onClick={async () => {
              setWorkflowMaxSelfFixSaving(true);
              try {
                const res = await fetch("/api/settings/app", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ workflowMaxSelfFixRetries }),
                });
                if (res.ok) {
                  const data = await res.json();
                  if (typeof data.workflowMaxSelfFixRetries === "number") setWorkflowMaxSelfFixRetries(data.workflowMaxSelfFixRetries);
                }
              } finally {
                setWorkflowMaxSelfFixSaving(false);
              }
            }}
          >
            {workflowMaxSelfFixSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: "1rem", marginTop: "0.75rem" }}>
        <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>About</div>
        <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>
          AgentOS Studio is a local-first platform for building, managing, and running AI agents.
          Configure your LLM providers, create agents with custom prompts, chain them into workflows,
          and use sandboxes for isolated code execution.
        </p>
      </div>

      <div className="card" style={{ padding: "1rem", marginTop: "0.75rem" }}>
        <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <FileJson size={16} /> Export / Import definitions
        </div>
        <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0 0 1rem", lineHeight: 1.5 }}>
          Export tools, agents, and workflows as JSON. Use the same file to import into another Studio (or this one). Standard tools (e.g. Fetch URL) are omitted from export and never overwritten on import.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
          <select
            id="export-type"
            className="select"
            style={{ width: "auto", minWidth: 140 }}
            defaultValue="all"
          >
            <option value="all">Export all</option>
            <option value="tools">Tools only</option>
            <option value="agents">Agents only</option>
            <option value="workflows">Workflows only</option>
          </select>
          <button
            type="button"
            className="button button-ghost button-small"
            onClick={async () => {
              const sel = document.getElementById("export-type") as HTMLSelectElement;
              const type = sel?.value ?? "all";
              const res = await fetch(`/api/export?type=${encodeURIComponent(type)}`);
              if (!res.ok) return;
              const blob = await res.blob();
              const disposition = res.headers.get("Content-Disposition");
              const match = disposition?.match(/filename="?([^";]+)"?/);
              const name = match?.[1] ?? `agentron-${type}-${new Date().toISOString().slice(0, 10)}.json`;
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = name;
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            <Download size={14} /> Download JSON
          </button>
        </div>
        <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--border)" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
            <input
              ref={defImportInputRef}
              type="file"
              accept=".json,application/json"
              style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setDefImportResult(null);
                setDefImportError(null);
                try {
                  const text = await file.text();
                  const parsed = JSON.parse(text) as Record<string, unknown>;
                  const payload = { ...parsed, options: { skipExisting: !defImportOverwrite } };
                  const res = await fetch("/api/import", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                  });
                  const data = await res.json();
                  if (!res.ok) {
                    setDefImportError(data.error ?? res.statusText);
                    return;
                  }
                  setDefImportResult(data.counts ?? data);
                  if (defImportInputRef.current) defImportInputRef.current.value = "";
                } catch (err) {
                  setDefImportError(err instanceof Error ? err.message : "Import failed");
                }
              }}
            />
            <button
              type="button"
              className="button button-ghost button-small"
              onClick={() => defImportInputRef.current?.click()}
            >
              <Upload size={14} /> Import from JSON
            </button>
            <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.82rem", color: "var(--text-muted)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={defImportOverwrite}
                onChange={(e) => setDefImportOverwrite(e.target.checked)}
              />
              Overwrite existing (by id)
            </label>
          </div>
          {defImportResult && (
            <pre style={{ fontSize: "0.75rem", margin: "0.5rem 0 0", padding: "0.5rem", background: "var(--surface-muted)", borderRadius: 6, overflow: "auto" }}>
              {JSON.stringify(defImportResult, null, 2)}
            </pre>
          )}
          {defImportError && (
            <p style={{ fontSize: "0.82rem", color: "#dc2626", margin: "0.5rem 0 0" }}>{defImportError}</p>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: "1rem", marginTop: "0.75rem" }}>
        <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <Database size={16} /> Backup &amp; Restore
        </div>
        <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0 0 1rem", lineHeight: 1.5 }}>
          Export a copy of your database for local or cloud backup (e.g. save the file to your drive or Dropbox).
          Restore replaces all current data with the backup; refresh the app after restoring.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-start" }}>
          <button
            type="button"
            className="button"
            disabled={backupLoading}
            onClick={async () => {
              setBackupLoading(true);
              try {
                const res = await fetch("/api/backup/export");
                if (!res.ok) throw new Error(res.statusText);
                const blob = await res.blob();
                const disposition = res.headers.get("Content-Disposition");
                const match = disposition?.match(/filename="?([^";]+)"?/);
                const name = match?.[1] ?? `agentron-backup-${new Date().toISOString().slice(0, 10)}.sqlite`;
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = name;
                a.click();
                URL.revokeObjectURL(a.href);
              } catch (e) {
                console.error(e);
              } finally {
                setBackupLoading(false);
              }
            }}
          >
            <Download size={14} /> {backupLoading ? "Preparing…" : "Download backup"}
          </button>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".sqlite,.sqlite3,.db"
              style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setRestoreError(null);
                setRestoreSuccess(false);
                setRestoreLoading(true);
                try {
                  const form = new FormData();
                  form.append("file", file);
                  const res = await fetch("/api/backup/restore", { method: "POST", body: form });
                  const data = await res.json();
                  if (!res.ok) {
                    setRestoreError(data.error ?? res.statusText);
                    return;
                  }
                  setRestoreSuccess(true);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                  setTimeout(() => setRestoreSuccess(false), 4000);
                } catch (err) {
                  setRestoreError(err instanceof Error ? err.message : "Restore failed");
                } finally {
                  setRestoreLoading(false);
                }
              }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                type="button"
                className="button button-ghost button-small"
                disabled={restoreLoading}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={14} /> {restoreLoading ? "Restoring…" : "Restore from file"}
              </button>
              {restoreSuccess && <span style={{ fontSize: "0.78rem", color: "#22c55e", fontWeight: 500 }}>Restored. Refresh the page.</span>}
              {restoreError && <span style={{ fontSize: "0.78rem", color: "#dc2626" }}>{restoreError}</span>}
            </div>
          </div>
        </div>
        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0.75rem 0 0", lineHeight: 1.4 }}>
          Restore will replace all agents, workflows, LLM configs, and other data. Use a backup created by this app.
        </p>
        <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--border)" }}>
          <button
            type="button"
            className="button button-ghost"
            onClick={() => setShowResetModal(true)}
            style={{ color: "#dc2626", fontSize: "0.85rem" }}
          >
            <RotateCcw size={14} /> Reset database
          </button>
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0.35rem 0 0", lineHeight: 1.4 }}>
            Drop all tables and re-create from the current schema. Clears all agents, workflows, LLM configs, and other data. Use if data is from an old schema or you want to start fresh.
          </p>
        </div>
      </div>

      <ConfirmModal
        open={showResetModal}
        title="Reset database"
        message="Clear all data and re-create tables from the current schema? All agents, workflows, LLM configs, and other data will be permanently deleted."
        warning="Refresh the app after reset."
        confirmLabel="Reset database"
        cancelLabel="Cancel"
        danger
        loading={resetLoading}
        onConfirm={async () => {
          setResetLoading(true);
          try {
            const res = await fetch("/api/backup/reset", { method: "POST" });
            const data = await res.json();
            if (res.ok) {
              setShowResetModal(false);
              window.location.href = "/";
            } else {
              console.error(data.error);
            }
          } finally {
            setResetLoading(false);
          }
        }}
        onCancel={() => !resetLoading && setShowResetModal(false)}
      />

      <div className="card" style={{ padding: "1rem", marginTop: "0.75rem" }}>
        <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>Debug</div>
        <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0 0 0.5rem" }}>
          Copy version, data directory path and recent API errors for GitHub issues.
        </p>
        <CopyDebugInfoButton />
      </div>

      <div className="card" style={{ padding: "1rem", marginTop: "0.75rem" }}>
        <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>Quick Links</div>
        <div style={{ display: "grid", gap: "0.4rem" }}>
          <a href="/settings/vault" style={{ fontSize: "0.82rem", color: "var(--primary)", textDecoration: "none" }}>
            Vault &rarr;
          </a>
          <a href="/settings/llm" style={{ fontSize: "0.82rem", color: "var(--primary)", textDecoration: "none" }}>
            LLM Providers &rarr;
          </a>
          <a href="/settings/telegram" style={{ fontSize: "0.82rem", color: "var(--primary)", textDecoration: "none" }}>
            Telegram &rarr;
          </a>
          <a href="/settings/container" style={{ fontSize: "0.82rem", color: "var(--primary)", textDecoration: "none" }}>
            Container Engine &rarr;
          </a>
          <a href="/agents" style={{ fontSize: "0.82rem", color: "var(--primary)", textDecoration: "none" }}>
            Agents &rarr;
          </a>
          <a href="/workflows" style={{ fontSize: "0.82rem", color: "var(--primary)", textDecoration: "none" }}>
            Workflows &rarr;
          </a>
          <a href="/tools" style={{ fontSize: "0.82rem", color: "var(--primary)", textDecoration: "none" }}>
            Tools &rarr;
          </a>
        </div>
      </div>
    </div>
  );
}
