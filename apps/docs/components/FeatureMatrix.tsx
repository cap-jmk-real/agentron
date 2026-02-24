import React from "react";
import Link from "next/link";

const ROWS: { feature: string; description: React.ReactNode; actions: React.ReactNode }[] = [
  {
    feature: "Agents",
    description: "Create, edit, delete node and code agents",
    actions: "create_agent, update_agent, delete_agent, get_agent",
  },
  {
    feature: "Workflows",
    description: "Multi-agent orchestration in graphs",
    actions: "create_workflow, update_workflow, add_workflow_edges, get_workflow",
  },
  {
    feature: "Tools",
    description: "Native, HTTP, MCP tools",
    actions: "create_tool, update_tool, list_tools, get_tool",
  },
  {
    feature: "Runs",
    description: "Execute workflows/agents, inspect results",
    actions: "list_runs, get_run",
  },
  {
    feature: "LLM Providers",
    description: "Configure OpenAI, Anthropic, Ollama, etc.",
    actions: "list_llm_providers (config via Settings)",
  },
  {
    feature: "Agentron (Chat)",
    description: "Natural-language chat that creates/edits via tool calls",
    actions: (
      <>
        <Link href="/concepts/assistant">Agentron (Chat)</Link>
      </>
    ),
  },
  {
    feature: "Sandboxes",
    description: (
      <>
        Container-engine sandboxes for code execution (
        <Link href="/podman-install">Container engine setup</Link>)
      </>
    ),
    actions: "create_sandbox, execute_code",
  },
  {
    feature: "Custom Functions",
    description: "JavaScript/Python/TypeScript as tools",
    actions: "create_custom_function",
  },
  {
    feature: "Knowledge / RAG",
    description: "Document ingestion and retrieval",
    actions: "UI-based; agents can use RAG collections",
  },
  {
    feature: "Feedback",
    description: "Rate agent outputs for learning",
    actions: "UI-based; stored for prompt refinement",
  },
  { feature: "Files", description: "Upload context files", actions: "list_files" },
  {
    feature: "Remote Servers",
    description: "SSH tunnel to remote LLMs (e.g. Ollama)",
    actions: "test_remote_connection, save_remote_server",
  },
];

export function FeatureMatrix() {
  return (
    <div className="feature-matrix-cards">
      <table>
        <thead>
          <tr>
            <th>Feature</th>
            <th>Description</th>
            <th>Primary actions</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.feature}>
              <td>
                <strong>{row.feature}</strong>
              </td>
              <td>{row.description}</td>
              <td>
                {row.feature === "Agentron (Chat)" ? <>Built-in; see {row.actions}</> : row.actions}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
