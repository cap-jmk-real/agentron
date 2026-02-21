"use client";

import { useEffect, useState, useMemo } from "react";
import { Check, Plus, Wrench, RefreshCw, Search } from "lucide-react";

type ToolDef = {
  id: string;
  name: string;
  protocol: string;
  config: Record<string, unknown>;
  inputSchema?: unknown;
  outputSchema?: unknown;
};

type Step = {
  id: string;
  name: string;
  type: "prompt" | "tool_call" | "condition" | "context_read" | "context_write";
  content: string;
  requiresApproval?: boolean;
};

type AgentDefinition = {
  systemPrompt?: string;
  steps?: Step[];
  toolIds?: string[];
  graph?: unknown;
  source?: string;
  entrypoint?: string;
};

type Props = {
  agentId: string;
  definition: AgentDefinition;
  onDefinitionChange: (def: AgentDefinition) => void;
};

export default function ToolsEditor({ agentId, definition, onDefinitionChange }: Props) {
  const [allTools, setAllTools] = useState<ToolDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newProtocol, setNewProtocol] = useState("native");
  const [creating, setCreating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const connectedIds = new Set(definition.toolIds ?? []);

  const fetchTools = () => {
    setLoading(true);
    fetch("/api/tools")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setAllTools(data);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchTools();
  }, []);

  const toggleTool = (toolId: string) => {
    const current = definition.toolIds ?? [];
    const next = connectedIds.has(toolId)
      ? current.filter((id) => id !== toolId)
      : [...current, toolId];
    onDefinitionChange({ ...definition, toolIds: next });
  };

  const createTool = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          protocol: newProtocol,
          config: {},
        }),
      });
      const tool = await res.json();
      setAllTools((prev) => [...prev, tool]);
      // Auto-connect new tool
      onDefinitionChange({
        ...definition,
        toolIds: [...(definition.toolIds ?? []), tool.id],
      });
      setNewName("");
      setShowCreate(false);
    } finally {
      setCreating(false);
    }
  };

  const connected = allTools.filter((t) => connectedIds.has(t.id));
  const availableAll = allTools.filter((t) => !connectedIds.has(t.id));
  const searchLower = searchQuery.trim().toLowerCase();
  const available = useMemo(
    () =>
      !searchLower
        ? availableAll
        : availableAll.filter(
            (t) =>
              t.name.toLowerCase().includes(searchLower) ||
              t.id.toLowerCase().includes(searchLower) ||
              (t.protocol && t.protocol.toLowerCase().includes(searchLower))
          ),
    [availableAll, searchLower]
  );
  const connectedFiltered = useMemo(
    () =>
      !searchLower
        ? connected
        : connected.filter(
            (t) =>
              t.name.toLowerCase().includes(searchLower) ||
              t.id.toLowerCase().includes(searchLower) ||
              (t.protocol && t.protocol.toLowerCase().includes(searchLower))
          ),
    [connected, searchLower]
  );

  if (loading) {
    return (
      <div className="card">
        <p style={{ color: "var(--text-muted)" }}>Loading tools...</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "1rem",
        }}
      >
        <div>
          <h3 style={{ margin: 0 }}>Connected Tools</h3>
          <p style={{ margin: "0.15rem 0 0", fontSize: "0.82rem", color: "var(--text-muted)" }}>
            Select which tools this agent can use during execution.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            className="button button-secondary button-small"
            onClick={fetchTools}
            title="Refresh tools"
          >
            <RefreshCw size={14} />
          </button>
          <button className="button button-small" onClick={() => setShowCreate(!showCreate)}>
            <Plus size={14} /> New Tool
          </button>
        </div>
      </div>

      {showCreate && (
        <div
          style={{
            marginBottom: "1rem",
            padding: "1rem",
            borderRadius: "12px",
            border: "1px solid var(--border)",
            background: "var(--surface-muted)",
          }}
        >
          <div className="section-label">Create New Tool</div>
          <div className="inline-form" style={{ marginTop: "0.5rem" }}>
            <div className="field">
              <label>Name</label>
              <input
                className="input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="my-tool"
              />
            </div>
            <div className="field">
              <label>Protocol</label>
              <select
                className="select"
                value={newProtocol}
                onChange={(e) => setNewProtocol(e.target.value)}
              >
                <option value="native">native</option>
                <option value="mcp">mcp</option>
                <option value="http">http</option>
              </select>
            </div>
            <button
              className="button button-small"
              onClick={createTool}
              disabled={creating || !newName.trim()}
              style={{ alignSelf: "end", marginBottom: "0.4rem" }}
            >
              {creating ? "Creating..." : "Create"}
            </button>
          </div>
        </div>
      )}

      <div className="agent-tools-search-wrap">
        <Search size={18} className="agent-tools-search-icon" aria-hidden />
        <input
          type="search"
          className="agent-tools-search-input"
          placeholder="Search tools by name, id, or protocol…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          autoComplete="off"
        />
      </div>

      {connected.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: "0.25rem" }}>
            Connected ({connectedFiltered.length}
            {searchQuery.trim() ? ` of ${connected.length}` : ""})
          </div>
          <div className="tool-grid" style={{ marginBottom: "1rem" }}>
            {connectedFiltered.map((tool) => (
              <div
                key={tool.id}
                className="tool-card tool-connected"
                onClick={() => toggleTool(tool.id)}
              >
                <div className="tool-card-check">
                  <Check size={14} />
                </div>
                <div className="tool-card-info">
                  <div className="tool-card-name">{tool.name}</div>
                  <div className="tool-card-meta">
                    {tool.protocol} &middot;{" "}
                    {Object.keys(tool.config ?? {}).length > 0 ? "configured" : "no config"}
                  </div>
                </div>
                <span className="tool-card-badge">{tool.protocol}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-label">
        Available Tools ({available.length}
        {searchQuery.trim() ? ` of ${availableAll.length}` : ""})
      </div>
      {available.length === 0 && connected.length === 0 ? (
        <div className="empty-state">
          <Wrench size={28} style={{ marginBottom: "0.5rem", opacity: 0.4 }} />
          <p style={{ fontSize: "0.95rem" }}>No tools available</p>
          <p style={{ fontSize: "0.82rem" }}>
            Create a tool above or go to the Tools page to define tools this agent can use.
          </p>
        </div>
      ) : available.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: "0.25rem 0" }}>
          {searchQuery.trim()
            ? "No tools match your search."
            : "All available tools are connected."}
        </p>
      ) : (
        <div className="tool-grid">
          {available.map((tool) => (
            <div key={tool.id} className="tool-card" onClick={() => toggleTool(tool.id)}>
              <div className="tool-card-check" />
              <div className="tool-card-info">
                <div className="tool-card-name">{tool.name}</div>
                <div className="tool-card-meta">
                  {tool.protocol} &middot;{" "}
                  {Object.keys(tool.config ?? {}).length > 0 ? "configured" : "no config"}
                </div>
              </div>
              <span className="tool-card-badge">{tool.protocol}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
