"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import ConfirmModal from "../../components/confirm-modal";

type ToolDef = {
  id: string;
  name: string;
  protocol: "native" | "http" | "mcp";
  config: Record<string, unknown>;
  inputSchema?: unknown;
  outputSchema?: unknown;
};

function safeStringify(obj: unknown): string {
  if (obj === undefined || obj === null) return "";
  try {
    return typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

function safeParseJson(str: string): Record<string, unknown> | undefined {
  if (!str.trim()) return undefined;
  try {
    const v = JSON.parse(str);
    return typeof v === "object" && v !== null ? v : undefined;
  } catch {
    return undefined;
  }
}

function safeParseSchema(str: string): unknown {
  if (!str.trim()) return undefined;
  try {
    return JSON.parse(str);
  } catch {
    return undefined;
  }
}

export default function ToolEditPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params?.id === "string" ? params.id : "";
  const [tool, setTool] = useState<ToolDef | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [protocol, setProtocol] = useState<ToolDef["protocol"]>("native");
  const [configJson, setConfigJson] = useState("{}");
  const [inputSchemaJson, setInputSchemaJson] = useState("");
  const [outputSchemaJson, setOutputSchemaJson] = useState("");
  // Adaptive HTTP form (when protocol is http)
  const [httpUrl, setHttpUrl] = useState("");
  const [httpMethod, setHttpMethod] = useState("GET");
  const [httpHeadersJson, setHttpHeadersJson] = useState("{}");
  const [httpBodyJson, setHttpBodyJson] = useState("");
  // Copy flow (for standard tools)
  const [copyName, setCopyName] = useState("");
  const [creatingCopy, setCreatingCopy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const res = await fetch(`/api/tools/${encodeURIComponent(id)}`);
    if (!res.ok) {
      setTool(null);
      return;
    }
    const data = await res.json();
    setTool(data);
    setName(data.name ?? "");
    setProtocol(data.protocol ?? "native");
    const cfg = data.config ?? {};
    setConfigJson(safeStringify(cfg));
    if (data.protocol === "http") {
      setHttpUrl((cfg.url as string) ?? "");
      setHttpMethod((cfg.method as string) ?? "GET");
      setHttpHeadersJson(safeStringify(cfg.headers ?? {}));
      setHttpBodyJson(typeof cfg.body === "string" ? cfg.body : safeStringify(cfg.body ?? ""));
    }
    setInputSchemaJson(safeStringify(data.inputSchema));
    setOutputSchemaJson(safeStringify(data.outputSchema));
    if (data.id?.startsWith("std-")) {
      setCopyName(`My ${data.name ?? "Copy"}`);
    }
  }, [id]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !tool) return;
    let config: Record<string, unknown>;
    if (protocol === "http") {
      const headers = safeParseJson(httpHeadersJson);
      let body: unknown = undefined;
      if (httpBodyJson.trim()) {
        const parsed = safeParseJson(httpBodyJson);
        body = parsed ?? httpBodyJson;
      }
      config = { url: httpUrl, method: httpMethod, headers: headers ?? {}, body };
    } else {
      config = safeParseJson(configJson) ?? {};
      if (configJson.trim() && !config) {
        alert("Invalid JSON in Config");
        return;
      }
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/tools/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          name: name.trim(),
          protocol,
          config,
          inputSchema: safeParseSchema(inputSchemaJson),
          outputSchema: safeParseSchema(outputSchemaJson),
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setTool(updated);
      }
    } finally {
      setSaving(false);
    }
  };

  const onConfirmDelete = async () => {
    if (!id) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/tools/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) router.push("/tools");
    } finally {
      setDeleting(false);
    }
  };

  const createCopy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tool || !copyName.trim()) return;
    setCreatingCopy(true);
    try {
      const res = await fetch("/api/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: copyName.trim(),
          protocol: tool.protocol,
          config: { ...(tool.config ?? {}), baseToolId: tool.id },
          inputSchema: safeParseSchema(inputSchemaJson) ?? tool.inputSchema,
          outputSchema: safeParseSchema(outputSchemaJson) ?? tool.outputSchema,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error ?? "Failed to create copy");
        return;
      }
      const created = await res.json();
      router.push(`/tools/${encodeURIComponent(created.id)}`);
    } finally {
      setCreatingCopy(false);
    }
  };

  if (loading) {
    return (
      <div>
        <p style={{ color: "var(--text-muted)" }}>Loading tool...</p>
      </div>
    );
  }
  if (!tool) {
    return (
      <div>
        <p style={{ color: "var(--text-muted)" }}>Tool not found.</p>
        <Link href="/tools" className="button button-ghost" style={{ marginTop: "0.5rem" }}>
          Back to Tools
        </Link>
      </div>
    );
  }

  const isStandard = tool.id.startsWith("std-");

  // Standard tools: show "Save a copy" flow so user can name and create their own copy
  if (isStandard) {
    return (
      <div>
        <Link
          href="/tools"
          className="button button-ghost button-small"
          style={{
            marginBottom: "1rem",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.4rem",
          }}
        >
          <ArrowLeft size={14} /> Tools
        </Link>
        <h1>{tool.name}</h1>
        <p style={{ color: "var(--text-muted)", marginTop: "0.25rem", marginBottom: "1rem" }}>
          Standard tools can&apos;t be edited. Save a copy with your own name to customize and use
          as your own tool.
        </p>
        <form onSubmit={createCopy} className="card">
          <div className="field">
            <label>Name for your copy</label>
            <input
              className="input"
              value={copyName}
              onChange={(e) => setCopyName(e.target.value)}
              placeholder="e.g. My Run Code"
              required
            />
            <small style={{ color: "var(--text-muted)" }}>
              Give your copy a name; you can edit the copy after it&apos;s created.
            </small>
          </div>
          <button type="submit" className="button" disabled={creatingCopy || !copyName.trim()}>
            {creatingCopy ? "Creating…" : "Save a copy"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div>
      <Link
        href="/tools"
        className="button button-ghost button-small"
        style={{
          marginBottom: "1rem",
          display: "inline-flex",
          alignItems: "center",
          gap: "0.4rem",
        }}
      >
        <ArrowLeft size={14} /> Tools
      </Link>
      <h1>{tool.name}</h1>
      <p style={{ color: "var(--text-muted)", marginTop: "0.25rem", marginBottom: "1rem" }}>
        Edit tool definition. Use the structured form for HTTP tools (endpoint, method, headers).
      </p>
      <form onSubmit={save} className="card">
        <div className="field">
          <label>Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>Protocol</label>
          <select
            className="select"
            value={protocol}
            onChange={(e) => setProtocol(e.target.value as ToolDef["protocol"])}
          >
            <option value="native">Native (code / built-in)</option>
            <option value="http">HTTP</option>
            <option value="mcp">MCP</option>
          </select>
        </div>

        {protocol === "http" ? (
          <>
            <div className="field">
              <label>URL (endpoint)</label>
              <input
                className="input"
                type="url"
                placeholder="https://api.example.com/..."
                value={httpUrl}
                onChange={(e) => setHttpUrl(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Method</label>
              <select
                className="select"
                value={httpMethod}
                onChange={(e) => setHttpMethod(e.target.value)}
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
                <option value="DELETE">DELETE</option>
              </select>
            </div>
            <div className="field">
              <label>Headers (JSON, optional)</label>
              <textarea
                className="input"
                rows={3}
                value={httpHeadersJson}
                onChange={(e) => setHttpHeadersJson(e.target.value)}
                placeholder='{ "Authorization": "Bearer ...", "Content-Type": "application/json" }'
                style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}
              />
            </div>
            <div className="field">
              <label>Body (JSON or text, optional)</label>
              <textarea
                className="input"
                rows={3}
                value={httpBodyJson}
                onChange={(e) => setHttpBodyJson(e.target.value)}
                placeholder='{ "key": "value" }'
                style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}
              />
            </div>
          </>
        ) : (
          <div className="field">
            <label>Config (JSON)</label>
            <textarea
              className="input"
              rows={6}
              value={configJson}
              onChange={(e) => setConfigJson(e.target.value)}
              placeholder='{ "key": "value" } — MCP: server config'
              style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}
            />
          </div>
        )}
        <div className="field">
          <label>Input schema (JSON, optional)</label>
          <textarea
            className="input"
            rows={4}
            value={inputSchemaJson}
            onChange={(e) => setInputSchemaJson(e.target.value)}
            placeholder='e.g. { "type": "object", "properties": { "url": { "type": "string" } } }'
            style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}
          />
        </div>
        <div className="field">
          <label>Output schema (JSON, optional)</label>
          <textarea
            className="input"
            rows={2}
            value={outputSchemaJson}
            onChange={(e) => setOutputSchemaJson(e.target.value)}
            style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}
          />
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="submit" className="button" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="button button-ghost"
            style={{ color: "#dc2626" }}
            onClick={() => setShowDelete(true)}
          >
            Delete tool
          </button>
        </div>
      </form>

      <ConfirmModal
        open={showDelete}
        title="Delete tool"
        message={`Delete "${tool.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        loading={deleting}
        onConfirm={onConfirmDelete}
        onCancel={() => !deleting && setShowDelete(false)}
      />
    </div>
  );
}
