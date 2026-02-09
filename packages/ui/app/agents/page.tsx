"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Bot, Plus, ChevronRight, Trash2, Download } from "lucide-react";
import ConfirmModal from "../components/confirm-modal";

type Agent = {
  id: string;
  name: string;
  kind: string;
  type: string;
  protocol: string;
};

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("node");
  const [protocol, setProtocol] = useState("native");
  const [agentToDelete, setAgentToDelete] = useState<Agent | null>(null);
  const [workflowWarning, setWorkflowWarning] = useState("");
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/agents", { cache: "no-store" });
    const data = await response.json();
    setAgents(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!agentToDelete) {
      setWorkflowWarning("");
      return;
    }
    let cancelled = false;
    fetch(`/api/agents/${agentToDelete.id}/workflow-usage`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data.workflows) && data.workflows.length > 0) {
          const names = data.workflows.map((w: { name: string }) => w.name).join(", ");
          setWorkflowWarning(`This agent is used in ${data.workflows.length} workflow(s): ${names}. Deleting may break them.`);
        } else {
          setWorkflowWarning("");
        }
      })
      .catch(() => {
        if (!cancelled) setWorkflowWarning("");
      });
    return () => { cancelled = true; };
  }, [agentToDelete]);

  const createAgent = async (event: React.FormEvent) => {
    event.preventDefault();
    await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        kind,
        type: "internal",
        protocol,
        capabilities: [],
        scopes: []
      })
    });
    setName("");
    await load();
  };

  const onConfirmDelete = async () => {
    if (!agentToDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/agents/${agentToDelete.id}`, { method: "DELETE" });
      if (res.ok) {
        setAgentToDelete(null);
        await load();
      }
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
        <h1 style={{ margin: 0 }}>Agents</h1>
        <a
          href="/api/export?type=agents"
          className="button button-ghost button-small"
          style={{ flexShrink: 0 }}
          onClick={async (e) => {
            e.preventDefault();
            const res = await fetch("/api/export?type=agents");
            if (!res.ok) return;
            const blob = await res.blob();
            const disposition = res.headers.get("Content-Disposition");
            const name = disposition?.match(/filename="?([^";]+)"?/)?.[1] ?? `agentron-agents-${new Date().toISOString().slice(0, 10)}.json`;
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
      <div className="card" style={{ marginTop: "0.5rem" }}>
        <form onSubmit={createAgent} className="form">
          <div className="field">
            <label>Name</label>
            <input
              className="input"
              placeholder="Agent name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div className="field">
              <label>Kind</label>
              <select className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="node">node (visual)</option>
                <option value="code">code</option>
              </select>
            </div>
            <div className="field">
              <label>Protocol</label>
              <select className="select" value={protocol} onChange={(e) => setProtocol(e.target.value)}>
                <option value="native">native</option>
                <option value="mcp">mcp</option>
                <option value="http">http</option>
              </select>
            </div>
          </div>
          <button type="submit" className="button">
            <Plus size={14} /> Create Agent
          </button>
        </form>
      </div>
      <ul className="list" style={{ marginTop: "1.5rem" }}>
        {agents.map((agent) => (
          <li key={agent.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Link
              href={agent.id ? `/agents/${encodeURIComponent(agent.id)}` : "/agents"}
              className="list-item"
              style={{ flex: 1, display: "flex", alignItems: "center", gap: "0.6rem", textDecoration: "none", color: "inherit" }}
            >
              <Bot size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{agent.name}</div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  {agent.kind} / {agent.type} / {agent.protocol}
                </div>
              </div>
              <ChevronRight size={14} style={{ color: "var(--text-muted)", marginLeft: "auto" }} />
            </Link>
            <button
              type="button"
              className="button button-ghost button-small"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setAgentToDelete(agent);
              }}
              disabled={deleting}
              title="Delete agent"
              style={{ color: "#dc2626", flexShrink: 0 }}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>

      <ConfirmModal
        open={!!agentToDelete}
        title="Delete agent"
        message={agentToDelete ? `Delete "${agentToDelete.name}"? This cannot be undone.` : ""}
        warning={workflowWarning || undefined}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        loading={deleting}
        onConfirm={onConfirmDelete}
        onCancel={() => !deleting && setAgentToDelete(null)}
      />
    </div>
  );
}
