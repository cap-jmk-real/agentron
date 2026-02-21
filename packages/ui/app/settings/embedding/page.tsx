"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Plus, Trash2, Pencil } from "lucide-react";
import ConfirmModal from "../../components/confirm-modal";

type EmbeddingProvider = {
  id: string;
  name: string;
  type: string;
  endpoint?: string;
  apiKeySet?: boolean;
  createdAt: number;
};

const EMBEDDING_TYPES = [
  { id: "openai", label: "OpenAI" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "local", label: "Local (Ollama)" },
  { id: "huggingface", label: "Hugging Face" },
  { id: "custom_http", label: "Custom HTTP" },
] as const;

export default function EmbeddingSettingsPage() {
  const [providers, setProviders] = useState<EmbeddingProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [type, setType] = useState<string>("local");
  const [endpoint, setEndpoint] = useState("http://localhost:11434");
  const [apiKey, setApiKey] = useState("");

  const loadProviders = useCallback(async () => {
    try {
      const res = await fetch("/api/rag/embedding-providers");
      const data = await res.json();
      setProviders(Array.isArray(data) ? data : []);
    } catch {
      setProviders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  const resetForm = () => {
    setName("");
    setType("local");
    setEndpoint("http://localhost:11434");
    setApiKey("");
    setShowForm(false);
    setEditingId(null);
    setSaveError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        type,
        endpoint:
          type === "local" || type === "custom_http" ? endpoint.trim() || undefined : undefined,
      };
      if (
        apiKey.trim() &&
        (type === "openai" ||
          type === "openrouter" ||
          type === "huggingface" ||
          type === "custom_http")
      ) {
        payload.extra = { apiKey: apiKey.trim() };
      }
      const url = editingId
        ? `/api/rag/embedding-providers/${encodeURIComponent(editingId)}`
        : "/api/rag/embedding-providers";
      const method = editingId ? "PUT" : "POST";
      if (editingId) payload.id = editingId;
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError((data.error as string) || res.statusText || "Failed to save");
        return;
      }
      resetForm();
      await loadProviders();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (p: EmbeddingProvider) => {
    setEditingId(p.id);
    setName(p.name);
    setType(p.type);
    setEndpoint(p.endpoint || (p.type === "local" ? "http://localhost:11434" : ""));
    setApiKey(""); // Never show existing key
    setShowForm(true);
    setSaveError(null);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/rag/embedding-providers/${encodeURIComponent(deleteTarget.id)}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setDeleteTarget(null);
        await loadProviders();
      }
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="card" style={{ padding: "1rem" }}>
        <p style={{ color: "var(--text-muted)" }}>Loading…</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 680 }}>
      <h1 style={{ margin: "0 0 0.25rem" }}>Embedding</h1>
      <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0 0 1.5rem" }}>
        Configure embedding endpoints for RAG. Use these in Knowledge when creating encoding
        configs.
      </p>

      <div className="card" style={{ padding: "1rem" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "0.75rem",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1rem" }}>Embedding providers</h2>
          <button
            type="button"
            className="button"
            onClick={() => {
              resetForm();
              setShowForm(true);
            }}
          >
            <Plus size={14} /> Add
          </button>
        </div>

        {showForm && (
          <form
            onSubmit={handleSubmit}
            className="form"
            style={{
              marginBottom: "1rem",
              padding: "1rem",
              background: "var(--bg-subtle)",
              borderRadius: "var(--radius)",
            }}
          >
            <div className="field">
              <label>Name</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Ollama local"
              />
            </div>
            <div className="field">
              <label>Type</label>
              <select
                className="select"
                value={type}
                onChange={(e) => {
                  setType(e.target.value);
                  if (e.target.value === "local") setEndpoint("http://localhost:11434");
                }}
              >
                {EMBEDDING_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            {(type === "local" || type === "custom_http") && (
              <div className="field">
                <label>Endpoint (base URL)</label>
                <input
                  className="input"
                  type="url"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder={type === "local" ? "http://localhost:11434" : "https://..."}
                />
              </div>
            )}
            {(type === "openai" ||
              type === "openrouter" ||
              type === "huggingface" ||
              type === "custom_http") && (
              <div className="field">
                <label>API key {editingId && "(leave blank to keep current)"}</label>
                <input
                  className="input"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="off"
                />
              </div>
            )}
            {saveError && (
              <p
                style={{
                  color: "var(--danger, #c00)",
                  fontSize: "0.85rem",
                  marginBottom: "0.5rem",
                }}
              >
                {saveError}
              </p>
            )}
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button type="submit" className="button button-primary" disabled={saving}>
                {saving ? "Saving…" : editingId ? "Save" : "Create"}
              </button>
              <button type="button" className="button" onClick={resetForm}>
                Cancel
              </button>
            </div>
          </form>
        )}

        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {providers.map((p) => (
            <li
              key={p.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "0.5rem 0",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <span>
                <strong>{p.name}</strong> — {p.type}
                {p.endpoint && ` (${p.endpoint})`}
                {p.apiKeySet && " · API key set"}
              </span>
              <span style={{ display: "flex", gap: "0.25rem" }}>
                <button
                  type="button"
                  className="button button-small"
                  onClick={() => startEdit(p)}
                  aria-label="Edit"
                >
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  className="button button-danger button-small"
                  onClick={() => setDeleteTarget({ id: p.id, name: p.name })}
                  aria-label="Delete"
                >
                  <Trash2 size={12} />
                </button>
              </span>
            </li>
          ))}
        </ul>
        {providers.length === 0 && !showForm && (
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginTop: "0.5rem" }}>
            No embedding providers. Add one to use with encoding configs in Knowledge.
          </p>
        )}
      </div>

      <p style={{ marginTop: "1rem" }}>
        <Link href="/settings" style={{ color: "var(--primary)" }}>
          ← Back to Settings
        </Link>
      </p>

      {deleteTarget && (
        <ConfirmModal
          open
          title="Delete embedding provider?"
          message={`Delete "${deleteTarget.name}"? Encoding configs using it will need to be updated.`}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
          confirmLabel="Delete"
          loading={deleting}
          danger
        />
      )}
    </div>
  );
}
