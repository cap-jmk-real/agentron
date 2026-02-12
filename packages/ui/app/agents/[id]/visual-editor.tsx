"use client";

type AgentDefinition = {
  systemPrompt?: string;
  steps?: { id: string; name: string; type: string; content: string }[];
  toolIds?: string[];
  graph?: { nodes: unknown[]; edges: unknown[] };
  source?: string;
  entrypoint?: string;
};

type Props = {
  agentId: string;
  definition: AgentDefinition;
  onDefinitionChange: (def: AgentDefinition) => void;
};

export default function VisualEditor({ agentId, definition, onDefinitionChange }: Props) {
  const graph = definition.graph ?? { nodes: [], edges: [] };
  const nodesStr = JSON.stringify(graph.nodes, null, 2);
  const edgesStr = JSON.stringify(graph.edges, null, 2);

  const updateGraph = (field: "nodes" | "edges", raw: string) => {
    try {
      const parsed = JSON.parse(raw);
      onDefinitionChange({
        ...definition,
        graph: { ...graph, [field]: parsed },
      });
    } catch {
      // ignore invalid JSON while typing
    }
  };

  return (
    <div className="card">
      <h3 style={{ margin: "0 0 0.25rem" }}>Visual Workflow</h3>
      <p style={{ margin: "0 0 1rem", fontSize: "0.82rem", color: "var(--text-muted)" }}>
        Define the tool graph for this agent. Each item is a tool (LLM, Input, Output, etc.) in the execution flow.
      </p>
      <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--text-muted)" }}>
        Tools / graph (JSON)
      </label>
      <textarea
        rows={8}
        className="textarea"
        defaultValue={nodesStr}
        onChange={(e) => updateGraph("nodes", e.target.value)}
      />
      <label style={{ display: "block", margin: "0.75rem 0 0.5rem", fontSize: "0.85rem", color: "var(--text-muted)" }}>
        Edges (JSON)
      </label>
      <textarea
        rows={5}
        className="textarea"
        defaultValue={edgesStr}
        onChange={(e) => updateGraph("edges", e.target.value)}
      />
    </div>
  );
}
