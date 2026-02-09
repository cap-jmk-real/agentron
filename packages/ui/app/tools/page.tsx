"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Wrench,
  Plus,
  Trash2,
  Download,
  Globe,
  Layout,
  Link2,
  Plug,
  Code,
  Mail,
  MessageCircle,
  Database,
  FileText,
  Clock,
  Zap,
  type LucideIcon,
} from "lucide-react";
import ConfirmModal from "../components/confirm-modal";

type ToolDef = {
  id: string;
  name: string;
  protocol: string;
  config: Record<string, unknown>;
  inputSchema?: unknown;
  outputSchema?: unknown;
};

/** Icon and theme by tool id, name (n8n-style), or protocol. See https://community.n8n.io/t/master-list-of-every-n8n-node/155146 */
function getToolIconAndTheme(tool: ToolDef): { Icon: LucideIcon; theme: string } {
  const id = tool.id.toLowerCase();
  const name = tool.name.toLowerCase();

  // Known standard tools
  if (id === "std-fetch-url") return { Icon: Globe, theme: "web" };
  if (id === "std-browser") return { Icon: Layout, theme: "web" };

  // Name-based (n8n-style: HTTP, Webhook, Code, Email, Slack, Database, File, Schedule, etc.)
  if (/\b(http|fetch|url|web|request)\b/.test(name)) return { Icon: Link2, theme: "http" };
  if (/\b(browser|puppeteer|playwright)\b/.test(name)) return { Icon: Layout, theme: "web" };
  if (/\b(webhook)\b/.test(name)) return { Icon: Zap, theme: "http" };
  if (/\b(code|script|function|run)\b/.test(name)) return { Icon: Code, theme: "code" };
  if (/\b(email|mail|smtp|gmail)\b/.test(name)) return { Icon: Mail, theme: "mail" };
  if (/\b(slack|discord|teams|chat|message)\b/.test(name)) return { Icon: MessageCircle, theme: "mail" };
  if (/\b(database|sql|postgres|mysql|mongo)\b/.test(name)) return { Icon: Database, theme: "db" };
  if (/\b(file|storage|drive|sheet)\b/.test(name)) return { Icon: FileText, theme: "file" };
  if (/\b(schedule|cron|interval|timer)\b/.test(name)) return { Icon: Clock, theme: "schedule" };

  // Protocol fallback
  if (tool.protocol === "http") return { Icon: Link2, theme: "http" };
  if (tool.protocol === "mcp") return { Icon: Plug, theme: "mcp" };

  return { Icon: Wrench, theme: "" };
}

export default function ToolsPage() {
  const [tools, setTools] = useState<ToolDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [protocol, setProtocol] = useState<"native" | "http" | "mcp">("native");
  const [creating, setCreating] = useState(false);
  const [toolToDelete, setToolToDelete] = useState<ToolDef | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/tools", { cache: "no-store" });
    const data = await res.json();
    setTools(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const createTool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), protocol, config: {} }),
      });
      const tool = await res.json();
      setTools((prev) => [...prev, tool]);
      setName("");
    } finally {
      setCreating(false);
    }
  };

  const onConfirmDelete = async () => {
    if (!toolToDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/tools/${encodeURIComponent(toolToDelete.id)}`, { method: "DELETE" });
      if (res.ok) {
        setToolToDelete(null);
        await load();
      }
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
        <div>
          <h1 style={{ margin: 0 }}>Tools</h1>
          <p style={{ color: "var(--text-muted)", marginTop: "0.25rem", marginBottom: 0 }}>
            Define tools agents can use (HTTP, MCP, or native). Like n8n nodes: web, code, email, database, and more. Attach them to agents in the agent editor.
          </p>
        </div>
        <a
          href="/api/export?type=tools"
          className="button button-ghost button-small"
          style={{ flexShrink: 0 }}
          onClick={async (e) => {
            e.preventDefault();
            const res = await fetch("/api/export?type=tools");
            if (!res.ok) return;
            const blob = await res.blob();
            const disposition = res.headers.get("Content-Disposition");
            const name = disposition?.match(/filename="?([^";]+)"?/)?.[1] ?? `agentos-tools-${new Date().toISOString().slice(0, 10)}.json`;
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = name;
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          <Download size={14} /> Export JSON
        </a>
      </div>
      <div className="card" style={{ marginTop: "1rem" }}>
        <form onSubmit={createTool} className="form">
          <div className="field">
            <label>Name</label>
            <input
              className="input"
              placeholder="e.g. Fetch API, Send Email, Run Code"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Protocol</label>
            <select className="select" value={protocol} onChange={(e) => setProtocol(e.target.value as ToolDef["protocol"])}>
              <option value="native">Native (code / built-in)</option>
              <option value="http">HTTP</option>
              <option value="mcp">MCP</option>
            </select>
          </div>
          <button type="submit" className="button" disabled={creating || !name.trim()}>
            <Plus size={14} /> New tool
          </button>
        </form>
      </div>

      {loading ? (
        <p style={{ color: "var(--text-muted)", marginTop: "1rem" }}>Loading tools...</p>
      ) : (
        <ul className="tools-grid" style={{ marginTop: "1.25rem" }}>
          {tools.map((tool) => {
            const { Icon, theme } = getToolIconAndTheme(tool);
            const themeClass = theme ? `tools-grid-card-${theme}` : "";
            const isStandard = tool.id.startsWith("std-");
            return (
              <li key={tool.id} style={{ position: "relative" }}>
                <Link
                  href={`/tools/${encodeURIComponent(tool.id)}`}
                  className={`tools-grid-card ${themeClass}`}
                >
                  <div className="tools-grid-card-icon">
                    <Icon size={24} strokeWidth={2} />
                  </div>
                  <span className="tools-grid-card-name">{tool.name}</span>
                  <div className="tools-grid-card-meta">
                    <span className="tools-grid-card-badge">{tool.protocol}</span>
                    {isStandard && <span className="tools-grid-card-badge">Standard</span>}
                  </div>
                  <div className="tools-grid-card-actions" onClick={(e) => e.preventDefault()}>
                    {!isStandard && (
                      <button
                        type="button"
                        className="button button-ghost button-small"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setToolToDelete(tool);
                        }}
                        disabled={deleting}
                        title="Delete tool"
                        style={{ color: "#dc2626" }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmModal
        open={!!toolToDelete}
        title="Delete tool"
        message={toolToDelete ? `Delete "${toolToDelete.name}"? Agents using this tool will no longer have access.` : ""}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        loading={deleting}
        onConfirm={onConfirmDelete}
        onCancel={() => !deleting && setToolToDelete(null)}
      />
    </div>
  );
}
