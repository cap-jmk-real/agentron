"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Zap } from "lucide-react";

type LLMConfig = {
  provider: string;
  model: string;
  apiKeyRef?: string;
  endpoint?: string;
};

type LLMPreset = LLMConfig & { id: string };

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
  llmConfig?: LLMConfig;
  definition?: unknown;
};

type Props = {
  agentId: string;
  agent: Agent;
  onUpdate: (agent: Agent) => void;
};

/** Providers that use an SDK with a fixed endpoint — endpoint field is not used. */
const PROVIDERS_WITHOUT_ENDPOINT = ["openrouter"];

const PROVIDERS = [
  { value: "local", label: "Local (Ollama / LM Studio)" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "azure", label: "Azure OpenAI" },
  { value: "gcp", label: "Google Cloud (Vertex)" },
  { value: "custom_http", label: "Custom HTTP" },
];

export default function LlmSettings({ agentId, agent, onUpdate }: Props) {
  const [presets, setPresets] = useState<LLMPreset[]>([]);
  const [loadingPresets, setLoadingPresets] = useState(true);

  const config = agent.llmConfig ?? { provider: "openai", model: "" };

  const fetchPresets = () => {
    setLoadingPresets(true);
    fetch("/api/llm/providers")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setPresets(data);
      })
      .finally(() => setLoadingPresets(false));
  };

  useEffect(() => {
    queueMicrotask(() => fetchPresets());
  }, []);

  const updateConfig = (patch: Partial<LLMConfig>) => {
    const updated = { ...config, ...patch };
    if (patch.provider !== undefined && PROVIDERS_WITHOUT_ENDPOINT.includes(patch.provider)) {
      updated.endpoint = undefined;
    }
    onUpdate({ ...agent, llmConfig: updated });
  };

  const applyPreset = (preset: LLMPreset) => {
    onUpdate({
      ...agent,
      llmConfig: {
        provider: preset.provider,
        model: preset.model,
        apiKeyRef: preset.apiKeyRef,
        endpoint: PROVIDERS_WITHOUT_ENDPOINT.includes(preset.provider) ? undefined : preset.endpoint,
      },
    });
  };

  const clearConfig = () => {
    const copy = { ...agent };
    delete copy.llmConfig;
    onUpdate(copy);
  };

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <div>
          <h3 style={{ margin: 0 }}>LLM Configuration</h3>
          <p style={{ margin: "0.15rem 0 0", fontSize: "0.82rem", color: "var(--text-muted)" }}>
            Select or configure the language model this agent uses for reasoning.
          </p>
        </div>
        {agent.llmConfig && (
          <button className="button button-secondary button-small" onClick={clearConfig}>
            Clear
          </button>
        )}
      </div>

      {/* Presets from saved LLM providers */}
      {!loadingPresets && presets.length > 0 && (
        <>
          <div className="section-label">Saved Providers</div>
          <div className="llm-presets">
            {presets.map((preset) => {
              const isActive =
                config.provider === preset.provider && config.model === preset.model;
              return (
                <div
                  key={preset.id}
                  className={`llm-preset ${isActive ? "llm-preset-active" : ""}`}
                  onClick={() => applyPreset(preset)}
                >
                  <div className="llm-preset-provider">{preset.provider}</div>
                  <div className="llm-preset-model">{preset.model}</div>
                  {!PROVIDERS_WITHOUT_ENDPOINT.includes(preset.provider) && preset.endpoint && (
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>
                      {preset.endpoint}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <hr className="divider" />
        </>
      )}

      {/* Manual config */}
      <div className="section-label">Manual Configuration</div>
      <div className="form" style={{ maxWidth: "100%" }}>
        <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "1fr 1fr" }}>
          <div className="field">
            <label>Provider</label>
            <select
              className="select"
              value={config.provider}
              onChange={(e) => updateConfig({ provider: e.target.value })}
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Model</label>
            <input
              className="input"
              value={config.model}
              onChange={(e) => updateConfig({ model: e.target.value })}
              placeholder={
                config.provider === "openai"
                  ? "gpt-4o"
                  : config.provider === "anthropic"
                  ? "claude-sonnet-4-20250514"
                  : config.provider === "local"
                  ? "llama3"
                  : "model-name"
              }
            />
          </div>
        </div>
        <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "1fr 1fr" }}>
          <div className="field">
            <label>API Key Reference</label>
            <input
              className="input"
              value={config.apiKeyRef ?? ""}
              onChange={(e) => updateConfig({ apiKeyRef: e.target.value || undefined })}
              placeholder="OPENAI_API_KEY"
            />
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              Environment variable name holding the API key
            </span>
          </div>
          {!PROVIDERS_WITHOUT_ENDPOINT.includes(config.provider) && (
            <div className="field">
              <label>Endpoint</label>
              <input
                className="input"
                value={config.endpoint ?? ""}
                onChange={(e) => updateConfig({ endpoint: e.target.value || undefined })}
                placeholder={
                  config.provider === "local"
                    ? "http://localhost:11434"
                    : "https://api.example.com/v1"
                }
              />
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                {config.provider === "local"
                  ? "Local LLM server address"
                  : "Override default API endpoint (optional)"}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Current config summary */}
      {agent.llmConfig && agent.llmConfig.model && (
        <>
          <hr className="divider" />
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", color: "var(--text-muted)" }}>
            <Zap size={14} style={{ color: "var(--primary)" }} />
            Active: <strong style={{ color: "var(--text)" }}>{config.provider} / {config.model}</strong>
            {!PROVIDERS_WITHOUT_ENDPOINT.includes(config.provider) && config.endpoint && <span>&middot; {config.endpoint}</span>}
          </div>
        </>
      )}
    </div>
  );
}
