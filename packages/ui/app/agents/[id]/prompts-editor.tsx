"use client";

import { useState } from "react";
import { Plus, Trash2, ChevronUp, ChevronDown, UserCheck } from "lucide-react";

type Step = {
  id: string;
  name: string;
  type: "prompt" | "tool_call" | "condition" | "context_read" | "context_write";
  content: string;
  /** When true, this step requires human approval before continuing (human-in-the-loop; only applies when agent runs in a workflow) */
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

export default function PromptsEditor({ agentId, definition, onDefinitionChange }: Props) {
  const systemPrompt = definition.systemPrompt ?? "";
  const steps = definition.steps ?? [];

  const setSystemPrompt = (value: string) => {
    onDefinitionChange({ ...definition, systemPrompt: value });
  };

  const setSteps = (newSteps: Step[]) => {
    onDefinitionChange({ ...definition, steps: newSteps });
  };

  const addStep = () => {
    const newStep: Step = {
      id: crypto.randomUUID(),
      name: `Step ${steps.length + 1}`,
      type: "prompt",
      content: "",
      requiresApproval: false,
    };
    setSteps([...steps, newStep]);
  };

  const updateStep = (id: string, patch: Partial<Step>) => {
    setSteps(steps.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const removeStep = (id: string) => {
    setSteps(steps.filter((s) => s.id !== id));
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;
    const copy = [...steps];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    setSteps(copy);
  };

  return (
    <div className="card">
      <div className="form" style={{ maxWidth: "100%" }}>
        <div className="field">
          <label>System Prompt</label>
          <p style={{ margin: "0 0 0.25rem", fontSize: "0.82rem", color: "var(--text-muted)" }}>
            The core instructions that define this agent&apos;s personality, role, and behavior.
          </p>
          <textarea
            className="textarea"
            rows={6}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="You are a helpful assistant that specializes in..."
          />
        </div>

        <hr className="divider" />

        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
            <div>
              <div className="section-label">Execution Steps</div>
              <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-muted)" }}>
                Define the ordered sequence of actions this agent performs.
              </p>
            </div>
            <button className="button button-small" onClick={addStep}>
              <Plus size={14} /> Add Step
            </button>
          </div>

          {steps.length === 0 ? (
            <div className="empty-state">
              <p style={{ fontSize: "0.95rem" }}>No steps defined yet</p>
              <p style={{ fontSize: "0.82rem" }}>
                Add steps to define how this agent processes requests — prompts, tool calls, conditions, and more.
              </p>
            </div>
          ) : (
            <div className="step-list">
              {steps.map((step, index) => (
                <div key={step.id} className="step-item">
                  <div className="step-header">
                    <div className="step-number">{index + 1}</div>
                    <input
                      className="input"
                      style={{ flex: 1 }}
                      value={step.name}
                      onChange={(e) => updateStep(step.id, { name: e.target.value })}
                      placeholder="Step name"
                    />
                    <select
                      className="select"
                      style={{ width: "auto", minWidth: "140px" }}
                      value={step.type}
                      onChange={(e) => updateStep(step.id, { type: e.target.value as Step["type"] })}
                    >
                      <option value="prompt">Prompt</option>
                      <option value="tool_call">Tool Call</option>
                      <option value="condition">Condition</option>
                      <option value="context_read">Context Read</option>
                      <option value="context_write">Context Write</option>
                    </select>
                    <label className="step-approval-toggle" title="When this agent runs in a workflow, pause here for human approval before continuing">
                      <UserCheck size={16} style={{ flexShrink: 0 }} />
                      <input
                        type="checkbox"
                        checked={!!step.requiresApproval}
                        onChange={(e) => updateStep(step.id, { requiresApproval: e.target.checked })}
                      />
                      <span>Approval</span>
                    </label>
                    <div className="step-actions">
                      <button
                        className="step-action-btn"
                        onClick={() => moveStep(index, -1)}
                        disabled={index === 0}
                        title="Move up"
                      >
                        <ChevronUp size={16} />
                      </button>
                      <button
                        className="step-action-btn"
                        onClick={() => moveStep(index, 1)}
                        disabled={index === steps.length - 1}
                        title="Move down"
                      >
                        <ChevronDown size={16} />
                      </button>
                      <button
                        className="step-action-btn"
                        onClick={() => removeStep(step.id)}
                        title="Remove step"
                        style={{ color: "#ef4444" }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                  <textarea
                    className="textarea"
                    rows={3}
                    style={{ minHeight: "80px" }}
                    value={step.content}
                    onChange={(e) => updateStep(step.id, { content: e.target.value })}
                    placeholder={
                      step.type === "prompt"
                        ? "Write the prompt instruction for this step..."
                        : step.type === "tool_call"
                        ? "Specify which tool to call and with what parameters..."
                        : step.type === "condition"
                        ? "Define the condition to evaluate (e.g., if result contains error)..."
                        : step.type === "context_read"
                        ? "Key to read from shared context..."
                        : "Key and value to write to shared context..."
                    }
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
