"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Workflow, MessageSquare, Wrench, ShieldCheck, Save, Trash2, BarChart3, BookOpen, ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import ConfirmModal from "../../components/confirm-modal";
import AgentCanvas from "./agent-canvas";
import PromptsEditor from "./prompts-editor";
import ToolsEditor from "./tools-editor";
import FeedbackPanel from "./feedback-panel";

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

type Agent = {
  id: string;
  name: string;
  description?: string;
  kind: string;
  type: string;
  protocol: string;
  endpoint?: string;
  capabilities: string[];
  scopes: unknown[];
  llmConfig?: {
    provider: string;
    model: string;
    endpoint?: string;
    apiKeyRef?: string;
  };
  definition?: AgentDefinition;
  ragCollectionId?: string | null;
};

type Collection = { id: string; name: string; scope: string };

const tabs = [
  { id: "prompts", label: "Prompts", icon: MessageSquare },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "visual", label: "Visual", icon: Workflow },
  { id: "knowledge", label: "Knowledge", icon: BookOpen },
  { id: "feedback", label: "Feedback", icon: BarChart3 },
  { id: "permissions", label: "Permissions", icon: ShieldCheck },
] as const;

type TabId = (typeof tabs)[number]["id"];

export default function AgentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const agentId = params.id as string;

  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("prompts");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState("node");
  const [protocol, setProtocol] = useState("native");
  const [endpoint, setEndpoint] = useState("");
  const [capabilities, setCapabilities] = useState("");
  const [definition, setDefinition] = useState<AgentDefinition>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [workflowWarning, setWorkflowWarning] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [ragCollectionId, setRagCollectionId] = useState<string | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [tools, setTools] = useState<{ id: string; name: string; protocol: string; config?: Record<string, unknown>; inputSchema?: unknown }[]>([]);
  const [llmConfigs, setLlmConfigs] = useState<{ id: string; provider: string; model: string }[]>([]);
  const [showGraphJson, setShowGraphJson] = useState(false);
  const [graphNodesStr, setGraphNodesStr] = useState("[]");
  const [graphEdgesStr, setGraphEdgesStr] = useState("[]");

  useEffect(() => {
    if (!agentId) {
      setLoading(false);
      return;
    }
    fetch(`/api/agents/${agentId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.error) return;
        setAgent(data);
        setName(data.name ?? "");
        setDescription(data.description ?? "");
        setKind(data.kind ?? "node");
        setProtocol(data.protocol ?? "native");
        setEndpoint(data.endpoint ?? "");
        setCapabilities((data.capabilities ?? []).join(", "));
        const rawDef = data.definition ?? {};
        const stepTypes: Step["type"][] = ["prompt", "tool_call", "condition", "context_read", "context_write"];
        const steps = rawDef.steps?.map((s: { id: string; name: string; type?: string; content: string; requiresApproval?: boolean }) => ({
          ...s,
          type: (stepTypes.includes(s.type as Step["type"]) ? s.type : "prompt") as Step["type"],
        }));
        setDefinition({ ...rawDef, steps });
        setRagCollectionId(data.ragCollectionId ?? null);
        const g = data.definition?.graph;
        setGraphNodesStr(JSON.stringify(Array.isArray(g?.nodes) ? g.nodes : [], null, 2));
        setGraphEdgesStr(JSON.stringify(Array.isArray(g?.edges) ? g.edges : [], null, 2));
      })
      .finally(() => setLoading(false));
  }, [agentId]);

  useEffect(() => {
    fetch("/api/rag/collections")
      .then((r) => r.json())
      .then((d) => setCollections(Array.isArray(d) ? d : []))
      .catch(() => setCollections([]));
  }, []);
  useEffect(() => {
    fetch("/api/llm/providers")
      .then((r) => r.json())
      .then((d) => setLlmConfigs(Array.isArray(d) ? d : []))
      .catch(() => setLlmConfigs([]));
  }, []);
  useEffect(() => {
    fetch("/api/tools")
      .then((r) => r.json())
      .then((d) => setTools(Array.isArray(d) ? d : []))
      .catch(() => setTools([]));
  }, []);

  const save = async () => {
    setSaving(true);
    let defToSave = definition;
    try {
      const parsedNodes = JSON.parse(graphNodesStr);
      const parsedEdges = JSON.parse(graphEdgesStr);
      if (Array.isArray(parsedNodes) && Array.isArray(parsedEdges)) {
        defToSave = { ...definition, graph: { nodes: parsedNodes, edges: parsedEdges } };
        const firstLlmNode = (parsedNodes as { parameters?: { llmConfigId?: string } }[]).find(
          (n) => n.parameters?.llmConfigId
        );
        const firstLlmId = firstLlmNode?.parameters?.llmConfigId;
        if (firstLlmId) {
          (defToSave as { defaultLlmConfigId?: string }).defaultLlmConfigId = firstLlmId;
        }
      }
    } catch {
      // Keep definition as is if JSON is invalid
    }
    const res = await fetch(`/api/agents/${agentId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...agent,
        name,
        description,
        kind,
        protocol,
        endpoint: endpoint || undefined,
        capabilities: capabilities.split(",").map((s) => s.trim()).filter(Boolean),
        definition: defToSave,
        ragCollectionId: ragCollectionId || undefined,
      }),
    });
    if (res.ok) {
      const updated = await res.json();
      setAgent(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
    setSaving(false);
  };

  useEffect(() => {
    if (!showDeleteModal) return;
    let cancelled = false;
    fetch(`/api/agents/${agentId}/workflow-usage`)
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
      .catch(() => { if (!cancelled) setWorkflowWarning(""); });
    return () => { cancelled = true; };
  }, [showDeleteModal, agentId]);

  const onConfirmDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/agents/${agentId}`, { method: "DELETE" });
      if (res.ok) {
        setShowDeleteModal(false);
        router.push("/agents");
      }
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <p className="loading-muted">Loading...</p>;
  if (!agentId || !agent) {
    return (
      <div className="card card-narrow">
        <p style={{ margin: 0, fontWeight: 600 }}>Agent not found</p>
        <p className="card-narrow-desc">
          The agent may have been deleted or the link is invalid.
        </p>
        <Link href="/agents" className="button">
          Back to Agents
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="agent-header">
        <Link href="/agents" className="back-link">
          <ArrowLeft size={14} /> Agents
        </Link>
        <div className="agent-header-row">
          <h1 className="page-title">{name || "Untitled Agent"}</h1>
          <div className="title-row">
            {saved && <span className="saved-badge">Saved</span>}
            <button className="button" onClick={save} disabled={saving}>
              <Save size={13} /> {saving ? "Saving..." : "Save"}
            </button>
            <button type="button" className="button button-danger" onClick={() => setShowDeleteModal(true)}>
              <Trash2 size={13} /> Delete
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <div className="form" style={{ maxWidth: "100%" }}>
          <div className="field" style={{ maxWidth: "24rem" }}>
            <label>Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label>Description</label>
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this agent do?" />
          </div>
          <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "1fr 1fr 1fr" }}>
            <div className="field">
              <label>Protocol</label>
              <select className="select" value={protocol} onChange={(e) => setProtocol(e.target.value)}>
                <option value="native">native</option>
                <option value="mcp">mcp</option>
                <option value="http">http</option>
              </select>
            </div>
            <div className="field">
              <label>Endpoint</label>
              <input className="input" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="http://..." />
            </div>
            <div className="field">
              <label>Capabilities</label>
              <input className="input" value={capabilities} onChange={(e) => setCapabilities(e.target.value)} placeholder="analysis, generation" />
            </div>
          </div>
        </div>
      </div>

      <div className="tabs">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              className={`tab ${activeTab === tab.id ? "tab-active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon size={14} /> {tab.label}
            </button>
          );
        })}
      </div>

      <div className="tab-content">
        {activeTab === "prompts" && <PromptsEditor agentId={agentId} definition={definition} onDefinitionChange={setDefinition} />}
        {activeTab === "tools" && <ToolsEditor agentId={agentId} definition={definition} onDefinitionChange={setDefinition} />}
        {activeTab === "knowledge" && (
          <div className="card">
            <h3 style={{ margin: "0 0 0.5rem" }}>RAG / Knowledge</h3>
            <p style={{ color: "var(--text-muted)", fontSize: "0.88rem", margin: "0 0 1rem" }}>
              Use studio knowledge (deployment collection for chat) or a custom collection for this agent.
            </p>
            <div className="field">
              <label>Knowledge source</label>
              <select
                className="select"
                value={ragCollectionId ?? ""}
                onChange={(e) => setRagCollectionId(e.target.value || null)}
              >
                <option value="">Use studio knowledge</option>
                {collections.filter((c) => c.scope === "agent").map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0.5rem 0 0" }}>
              Manage collections under <Link href="/knowledge" style={{ color: "var(--link)" }}>Knowledge</Link> in the sidebar.
            </p>
          </div>
        )}
        {activeTab === "feedback" && (
          <FeedbackPanel
            agentId={agentId}
            onApplyRefinement={(systemPrompt, steps) => {
              const updated = { ...definition, systemPrompt };
              if (steps) {
                const stepTypes: Step["type"][] = ["prompt", "tool_call", "condition", "context_read", "context_write"];
                updated.steps = steps.map((s) => ({
                  id: crypto.randomUUID(),
                  name: s.name,
                  type: (stepTypes.includes(s.type as Step["type"]) ? s.type : "prompt") as Step["type"],
                  content: s.content,
                }));
              }
              setDefinition(updated);
            }}
          />
        )}
        {activeTab === "visual" && (
          <>
          <div className="card canvas-card" style={{ padding: 0 }}>
            <div className="canvas-card-header">
              <h3 className="canvas-card-header-title">Agent graph</h3>
              <p className="canvas-card-header-desc">
                Add tools (LLM, Input, Output, Decision, Context, and library tools). Connect them to define execution flow. Customize each tool without changing the library.
              </p>
            </div>
            <AgentCanvas
                nodes={(() => {
                  try {
                    const n = JSON.parse(graphNodesStr);
                    const g = definition.graph as { nodes?: unknown[]; edges?: unknown[] } | undefined;
                    return (Array.isArray(n) ? n : g?.nodes ?? []) as { id: string; type: string; position: [number, number]; parameters?: Record<string, unknown> }[];
                  } catch {
                    const g = definition.graph as { nodes?: unknown[]; edges?: unknown[] } | undefined;
                    return (g?.nodes ?? []) as { id: string; type: string; position: [number, number]; parameters?: Record<string, unknown> }[];
                  }
                })()}
                edges={(() => {
                  try {
                    const e = JSON.parse(graphEdgesStr);
                    const g = definition.graph as { nodes?: unknown[]; edges?: unknown[] } | undefined;
                    return (Array.isArray(e) ? e : g?.edges ?? []) as { id: string; source: string; target: string }[];
                  } catch {
                    const g = definition.graph as { nodes?: unknown[]; edges?: unknown[] } | undefined;
                    return (g?.edges ?? []) as { id: string; source: string; target: string }[];
                  }
                })()}
                tools={tools}
                llmConfigs={llmConfigs}
                onNodesEdgesChange={(nodes, edges) => {
                  setDefinition({ ...definition, graph: { nodes, edges } });
                  setGraphNodesStr(JSON.stringify(nodes, null, 2));
                  setGraphEdgesStr(JSON.stringify(edges, null, 2));
                }}
                onSaveToolToLibrary={async (nodeId, baseToolId, override) => {
                  const base = tools.find((t) => t.id === baseToolId);
                  if (!base) return null;
                  const merged = {
                    name: override.name ?? `${base.name} (copy)`,
                    protocol: base.protocol,
                    config: { ...(base.config ?? {}), ...(override.config ?? {}) },
                    inputSchema: override.inputSchema ?? base.inputSchema,
                  };
                  const res = await fetch("/api/tools", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(merged),
                  });
                  const created = await res.json();
                  if (!res.ok || !created?.id) return null;
                  const graph = definition.graph as { nodes?: unknown[]; edges?: unknown[] } | undefined;
                  const nextNodes = ((graph?.nodes ?? []) as { id: string; type: string; position: [number, number]; parameters?: Record<string, unknown> }[]).map((n) =>
                    n.id === nodeId && n.type === "tool"
                      ? { ...n, parameters: { ...(n.parameters ?? {}), toolId: created.id, override: undefined } }
                      : n
                  );
                  const toolIds = [...new Set([...(definition.toolIds ?? []), created.id])];
                  const nextEdges = (definition.graph as { nodes?: unknown[]; edges?: unknown[] } | undefined)?.edges ?? [];
                  setDefinition({ ...definition, graph: { nodes: nextNodes, edges: nextEdges }, toolIds });
                  setGraphNodesStr(JSON.stringify(nextNodes, null, 2));
                  setTools((prev) => [...prev, created]);
                  return created.id;
                }}
              />
          </div>
          <div className="card form form-wide" style={{ marginTop: "1.5rem" }}>
            <button
              type="button"
              className={`advanced-toggle ${showGraphJson ? "expanded" : ""}`}
              onClick={() => setShowGraphJson(!showGraphJson)}
            >
              {showGraphJson ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              Advanced: edit graph as JSON
            </button>
            {showGraphJson && (
              <>
                <div className="field">
                  <label>Graph / tools (JSON)</label>
                  <textarea
                    className="textarea"
                    rows={8}
                    value={graphNodesStr}
                    onChange={(e) => setGraphNodesStr(e.target.value)}
                    placeholder='[{"id":"n1","type":"llm","position":[100,50],"parameters":{"systemPrompt":"..."}}]'
                  />
                </div>
                <div className="field">
                  <label>Edges (JSON)</label>
                  <textarea
                    className="textarea"
                    rows={4}
                    value={graphEdgesStr}
                    onChange={(e) => setGraphEdgesStr(e.target.value)}
                    placeholder='[{"id":"e1","source":"n1","target":"n2"}]'
                  />
                </div>
              </>
            )}
          </div>
          </>
        )}
        {activeTab === "permissions" && (
          <div className="card">
            <h3 style={{ margin: "0 0 0.25rem" }}>Scopes &amp; Permissions</h3>
            <p className="text-muted" style={{ fontSize: "0.82rem", margin: 0 }}>
              Coming soon — scope-based access control for tools, context keys, and external endpoints.
            </p>
          </div>
        )}
      </div>

      <ConfirmModal
        open={showDeleteModal}
        title="Delete agent"
        message="Delete this agent? This cannot be undone."
        warning={workflowWarning || undefined}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        loading={deleting}
        onConfirm={onConfirmDelete}
        onCancel={() => !deleting && setShowDeleteModal(false)}
      />
    </div>
  );
}
