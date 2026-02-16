"use client";

type AgentDefinition = {
  systemPrompt?: string;
  steps?: unknown[];
  toolIds?: string[];
  graph?: unknown;
  source?: string;
  entrypoint?: string;
};

type Props = {
  definition: AgentDefinition;
  onDefinitionChange: (def: AgentDefinition) => void;
};

export default function PromptsEditor({ definition, onDefinitionChange }: Props) {
  const systemPrompt = definition.systemPrompt ?? "";

  const setSystemPrompt = (value: string) => {
    onDefinitionChange({ ...definition, systemPrompt: value });
  };

  return (
    <div className="card">
      <div className="form" style={{ maxWidth: "100%" }}>
        <div className="field">
          <label>System Prompt</label>
          <p style={{ margin: "0 0 0.25rem", fontSize: "0.82rem", color: "var(--text-muted)" }}>
            The core instructions that define this agent&apos;s personality, role, and behavior. Execution flow is defined by the <strong>Agent graph</strong> in the Visual tab (nodes and edges).
          </p>
          <textarea
            className="textarea"
            rows={6}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="You are a helpful assistant that specializes in..."
          />
        </div>
      </div>
    </div>
  );
}
