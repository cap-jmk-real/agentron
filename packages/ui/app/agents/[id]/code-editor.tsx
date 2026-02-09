"use client";

const defaultCode = `export async function run(input, context) {
  return { input, note: "Hello from code agent" };
}
`;

type AgentDefinition = {
  systemPrompt?: string;
  steps?: { id: string; name: string; type: string; content: string }[];
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

export default function CodeEditor({ agentId, definition, onDefinitionChange }: Props) {
  const source = definition.source ?? defaultCode;
  const entrypoint = definition.entrypoint ?? "run";

  return (
    <div className="card">
      <h3 style={{ margin: "0 0 0.25rem" }}>Code Agent</h3>
      <p style={{ margin: "0 0 1rem", fontSize: "0.82rem", color: "var(--text-muted)" }}>
        Write TypeScript code that defines this agent&apos;s behavior.
      </p>
      <div className="form" style={{ maxWidth: "100%" }}>
        <div className="field">
          <label>Entrypoint function</label>
          <input
            className="input"
            value={entrypoint}
            onChange={(e) =>
              onDefinitionChange({ ...definition, entrypoint: e.target.value })
            }
            placeholder="run"
          />
        </div>
        <div className="field">
          <label>Source Code (TypeScript)</label>
          <textarea
            className="textarea"
            rows={14}
            value={source}
            onChange={(e) =>
              onDefinitionChange({ ...definition, source: e.target.value })
            }
            style={{ fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace", fontSize: "0.88rem" }}
          />
        </div>
      </div>
    </div>
  );
}
