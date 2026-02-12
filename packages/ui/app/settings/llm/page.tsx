"use client";

import { useEffect, useState, useCallback } from "react";

interface RateLimitConfig {
  requestsPerMinute?: number;
  tokensPerMinute?: number;
}

interface LlmProvider {
  id: string;
  provider: string;
  model: string;
  endpoint?: string;
  apiKeyRef?: string;
  extra?: { rateLimit?: RateLimitConfig; contextLength?: number };
}

/** OpenRouter key/limits response (https://openrouter.ai/docs/api/reference/limits) */
interface OpenRouterKeyData {
  data?: {
    label?: string;
    limit: number | null;
    limit_reset: string | null;
    limit_remaining: number | null;
    usage: number;
    usage_daily: number;
    usage_weekly: number;
    usage_monthly: number;
    is_free_tier?: boolean;
  };
}

/** Providers that use an SDK with a fixed endpoint — no endpoint field in UI or config. */
const PROVIDERS_WITHOUT_ENDPOINT = ["openrouter"];

const PROVIDER_PRESETS: Record<string, { model: string; endpoint?: string }> = {
  local: { model: "llama3.1:8b", endpoint: "http://localhost:11434" },
  openai: { model: "gpt-4o", endpoint: "https://api.openai.com/v1" },
  anthropic: { model: "claude-sonnet-4-20250514", endpoint: "https://api.anthropic.com" },
  openrouter: { model: "openrouter/free" },
  huggingface: { model: "meta-llama/Llama-3.1-8B-Instruct", endpoint: "https://api-inference.huggingface.co" },
  azure: { model: "gpt-4o", endpoint: "" },
  gcp: { model: "gemini-2.5-pro", endpoint: "" },
  custom_http: { model: "", endpoint: "" },
};

export default function LlmSettingsPage() {
  const [providers, setProviders] = useState<LlmProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; msg: string }>>({});

  // Form state
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState(PROVIDER_PRESETS.openai.model);
  const [endpoint, setEndpoint] = useState(PROVIDER_PRESETS.openai.endpoint ?? "");
  const [apiKey, setApiKey] = useState("");
  const [rateLimitRPM, setRateLimitRPM] = useState<string>("");
  const [rateLimitTPM, setRateLimitTPM] = useState<string>("");
  const [contextLengthInput, setContextLengthInput] = useState<string>("");
  const [defaultLimits, setDefaultLimits] = useState<Record<string, RateLimitConfig>>({});
  const [catalogModels, setCatalogModels] = useState<Array<{ id: string; name: string; contextLength?: number }>>([]);
  const [openrouterKeyInfo, setOpenrouterKeyInfo] = useState<Record<string, { loading: boolean; error?: string; envVar?: string; hint?: string; data?: OpenRouterKeyData }>>({});

  const loadProviders = useCallback(async () => {
    const res = await fetch("/api/llm/providers");
    const data = await res.json();
    setProviders(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => { loadProviders(); }, [loadProviders]);

  useEffect(() => {
    fetch("/api/llm/rate-limit-defaults").then((r) => r.json()).then(setDefaultLimits).catch(() => ({}));
  }, []);

  // Fetch OpenRouter key/limits for OpenRouter providers (uses stored key server-side)
  useEffect(() => {
    const openrouterIds = providers
      .filter((p) => p.provider === "openrouter")
      .map((p) => p.id);
    if (openrouterIds.length === 0) {
      setOpenrouterKeyInfo({});
      return;
    }
    setOpenrouterKeyInfo((prev) => {
      const next = { ...prev };
      openrouterIds.forEach((id) => {
        if (!next[id]) next[id] = { loading: true };
      });
      return next;
    });
    openrouterIds.forEach(async (id) => {
      try {
        const res = await fetch(`/api/llm/providers/${id}/openrouter-key`);
        const data = await res.json();
        if (!res.ok) {
          setOpenrouterKeyInfo((prev) => ({
            ...prev,
            [id]: {
              loading: false,
              error: data.error || res.statusText,
              envVar: data.envVar,
              hint: data.hint,
            },
          }));
          return;
        }
        setOpenrouterKeyInfo((prev) => ({ ...prev, [id]: { loading: false, data: data as OpenRouterKeyData } }));
      } catch {
        setOpenrouterKeyInfo((prev) => ({ ...prev, [id]: { loading: false, error: "Failed to fetch" } }));
      }
    });
  }, [providers]);

  const loadCatalog = useCallback(async (prov: string) => {
    try {
      const res = await fetch(`/api/llm/models?provider=${prov}`);
      const data = await res.json();
      setCatalogModels(Array.isArray(data) ? data : []);
    } catch {
      setCatalogModels([]);
    }
  }, []);

  // When catalog has models, ensure selected model is in catalog (only allow valid model names)
  useEffect(() => {
    if (catalogModels.length > 0 && !catalogModels.some((m) => m.id === model)) {
      setModel(catalogModels[0].id);
    }
  }, [catalogModels, model]);

  // When model selection changes in "Add" form, default context length from catalog (edit form keeps saved value)
  const selectedCatalogModel = catalogModels.find((m) => m.id === model);
  useEffect(() => {
    if (editingId != null) return;
    if (selectedCatalogModel?.contextLength != null) setContextLengthInput(String(selectedCatalogModel.contextLength));
  }, [editingId, selectedCatalogModel?.id, selectedCatalogModel?.contextLength]);

  const onProviderChange = (val: string) => {
    setProvider(val);
    const preset = PROVIDER_PRESETS[val];
    if (preset) {
      setModel(preset.model);
      setEndpoint(PROVIDERS_WITHOUT_ENDPOINT.includes(val) ? "" : preset.endpoint ?? "");
    }
    const d = defaultLimits[val];
    setRateLimitRPM(d?.requestsPerMinute != null ? String(d.requestsPerMinute) : "");
    setRateLimitTPM(d?.tokensPerMinute != null ? String(d.tokensPerMinute) : "");
    loadCatalog(val);
  };

  const buildPayload = (): Record<string, unknown> => {
    const rateLimit: RateLimitConfig = {};
    if (rateLimitRPM.trim()) rateLimit.requestsPerMinute = parseInt(rateLimitRPM, 10);
    if (rateLimitTPM.trim()) rateLimit.tokensPerMinute = parseInt(rateLimitTPM, 10);
    const payload: Record<string, unknown> = {
      provider,
      model,
      ...(PROVIDERS_WITHOUT_ENDPOINT.includes(provider) ? {} : { endpoint: endpoint || undefined }),
      ...(Object.keys(rateLimit).length ? { rateLimit } : {}),
    };
    if (apiKey.trim()) payload.apiKey = apiKey.trim();
    const ctx = contextLengthInput.trim() ? parseInt(contextLengthInput, 10) : undefined;
    if (ctx != null && !Number.isNaN(ctx) && ctx > 0) payload.contextLength = ctx;
    return payload;
  };

  const addProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await fetch("/api/llm/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      setShowForm(false);
      setApiKey("");
      setRateLimitRPM("");
      setRateLimitTPM("");
      setContextLengthInput("");
      await loadProviders();
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (p: LlmProvider) => {
    setEditingId(p.id);
    setProvider(p.provider);
    setModel(p.model);
    setEndpoint(p.endpoint ?? PROVIDER_PRESETS[p.provider]?.endpoint ?? "");
    setApiKey(""); // Never show or send existing key; leave blank to keep current
    setRateLimitRPM(p.extra?.rateLimit?.requestsPerMinute != null ? String(p.extra.rateLimit.requestsPerMinute) : "");
    setRateLimitTPM(p.extra?.rateLimit?.tokensPerMinute != null ? String(p.extra.rateLimit.tokensPerMinute) : "");
    setContextLengthInput(p.extra?.contextLength != null ? String(p.extra.contextLength) : "");
    loadCatalog(p.provider);
    const d = defaultLimits[p.provider];
    if (p.extra?.rateLimit?.requestsPerMinute == null && d?.requestsPerMinute != null) setRateLimitRPM(String(d.requestsPerMinute));
    if (p.extra?.rateLimit?.tokensPerMinute == null && d?.tokensPerMinute != null) setRateLimitTPM(String(d.tokensPerMinute));
  };

  const updateProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    setSaving(true);
    try {
      await fetch(`/api/llm/providers/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      setEditingId(null);
      await loadProviders();
    } finally {
      setSaving(false);
    }
  };

  const deleteProvider = async (id: string) => {
    await fetch(`/api/llm/providers/${id}`, { method: "DELETE" });
    setProviders((prev) => prev.filter((p) => p.id !== id));
  };

  const testProvider = async (p: LlmProvider) => {
    setTestingId(p.id);
    setTestResult((prev) => ({ ...prev, [p.id]: { ok: true, msg: "Testing..." } }));
    try {
      const res = await fetch(`/api/llm/providers/${p.id}/test`, { method: "POST" });
      const data = await res.json();
      setTestResult((prev) => ({
        ...prev,
        [p.id]: res.ok
          ? { ok: true, msg: data.message || "Connection successful" }
          : { ok: false, msg: data.error || "Connection failed" },
      }));
    } catch {
      setTestResult((prev) => ({ ...prev, [p.id]: { ok: false, msg: "Network error" } }));
    } finally {
      setTestingId(null);
    }
  };

  const providerLabel = (p: string) => {
    const labels: Record<string, string> = {
      local: "Local (Ollama)", openai: "OpenAI", anthropic: "Anthropic",
      openrouter: "OpenRouter", huggingface: "Hugging Face",
      azure: "Azure OpenAI", gcp: "Google Cloud", custom_http: "Custom HTTP",
    };
    return labels[p] || p;
  };

  return (
    <div style={{ maxWidth: 680 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.25rem" }}>
        <div>
          <h1 style={{ margin: 0 }}>LLM Providers</h1>
          <p style={{ margin: "0.25rem 0 0", fontSize: "0.82rem", color: "var(--text-muted)" }}>
            Configure language model providers for your agents and the AI assistant.
          </p>
        </div>
        {!showForm && providers.length > 0 && (
          <button
            className="button"
            onClick={() => {
              setEditingId(null);
              setShowForm(true);
              setContextLengthInput("");
              loadCatalog(provider);
              const d = defaultLimits[provider];
              setRateLimitRPM(d?.requestsPerMinute != null ? String(d.requestsPerMinute) : "");
              setRateLimitTPM(d?.tokensPerMinute != null ? String(d.tokensPerMinute) : "");
            }}
          >
            + Add Provider
          </button>
        )}
      </div>

      {/* Add provider form */}
      {showForm && !editingId && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <div style={{ padding: "0.85rem 1rem", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>New Provider</span>
            <button type="button" className="button button-ghost button-small" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
          <form onSubmit={addProvider} className="form" style={{ padding: "1rem" }}>
            <div className="field">
              <label>Provider</label>
              <select className="select" value={provider} onChange={(e) => onProviderChange(e.target.value)}>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="openrouter">OpenRouter</option>
                <option value="huggingface">Hugging Face</option>
                <option value="local">Local (Ollama)</option>
                <option value="azure">Azure OpenAI</option>
                <option value="gcp">Google Cloud</option>
                <option value="custom_http">Custom HTTP</option>
              </select>
            </div>
            <div className="field">
              <label>Model</label>
              {catalogModels.length > 0 ? (
                <select
                  className="select"
                  value={catalogModels.some((m) => m.id === model) ? model : catalogModels[0]?.id ?? ""}
                  onChange={(e) => setModel(e.target.value)}
                >
                  {catalogModels.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              ) : (
                <input className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. model-id (no catalog for this provider)" />
              )}
            </div>
            <div className="field">
              <label>Context length (tokens)</label>
              <input
                className="input"
                type="number"
                min={1}
                step={1000}
                value={contextLengthInput}
                onChange={(e) => setContextLengthInput(e.target.value)}
                placeholder={selectedCatalogModel?.contextLength != null ? `Default for model: ${selectedCatalogModel.contextLength.toLocaleString()}` : "e.g. 128000 (optional)"}
              />
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                Max context window for this model. Used to cap workflow memory and RAG. Leave blank to use model default when available.
              </span>
            </div>
            {!PROVIDERS_WITHOUT_ENDPOINT.includes(provider) && (
              <div className="field">
                <label>Endpoint</label>
                <input className="input" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://api.openai.com/v1" />
              </div>
            )}
            {provider !== "local" && (
              <div className="field">
                <label>API Key</label>
                {editingId ? (
                  <>
                    <div style={{ fontSize: "0.9rem", letterSpacing: "0.15em", color: "var(--text-muted)", marginBottom: "0.35rem" }} aria-hidden="true">
                      ••••••••••••••••••••••••
                    </div>
                    <input
                      className="input"
                      type="password"
                      autoComplete="new-password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="Enter new key to replace (leave blank to keep current)"
                    />
                  </>
                ) : (
                  <input
                    className="input"
                    type="password"
                    autoComplete="off"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={provider === "openrouter" ? "sk-or-v1-..." : "sk-..."}
                  />
                )}
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  {editingId ? "Key is never loaded or shown. Enter a new value only to replace it." : "Stored securely and never shown again. Used only for API requests."}
                </span>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div className="field">
                <label>Rate limit: requests/min</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={rateLimitRPM}
                  onChange={(e) => setRateLimitRPM(e.target.value)}
                  placeholder={defaultLimits[provider]?.requestsPerMinute != null ? `Default: ${defaultLimits[provider].requestsPerMinute}` : "Default by provider"}
                />
              </div>
              <div className="field">
                <label>Rate limit: tokens/min</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={rateLimitTPM}
                  onChange={(e) => setRateLimitTPM(e.target.value)}
                  placeholder={defaultLimits[provider]?.tokensPerMinute != null ? `Default: ${defaultLimits[provider].tokensPerMinute}` : "Optional"}
                />
              </div>
            </div>
            <button type="submit" className="button" disabled={saving || !model.trim()}>
              {saving ? "Saving..." : "Save Provider"}
            </button>
          </form>
        </div>
      )}

      {/* Provider list */}
      {loading ? (
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Loading...</p>
      ) : providers.length === 0 && !showForm ? (
        <div className="card" style={{ padding: "2rem", textAlign: "center" }}>
          <p style={{ fontSize: "0.88rem", fontWeight: 500, margin: "0 0 0.4rem" }}>No providers configured</p>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0 0 1rem" }}>
            Add an LLM provider to start using agents and the AI assistant.
          </p>
          <button className="button" onClick={() => { setShowForm(true); loadCatalog(provider); }}>+ Add Provider</button>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "0.5rem" }}>
          {providers.map((p) => (
            <div key={p.id}>
              {editingId === p.id ? (
                <div className="card" style={{ marginBottom: "0.5rem" }}>
                  <div style={{ padding: "0.85rem 1rem", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>Edit Provider</span>
                    <button type="button" className="button button-ghost button-small" onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                  <form onSubmit={updateProvider} className="form" style={{ padding: "1rem" }}>
                    <div className="field">
                      <label>Provider</label>
                      <select className="select" value={provider} onChange={(e) => onProviderChange(e.target.value)}>
                        <option value="openai">OpenAI</option>
                        <option value="anthropic">Anthropic</option>
                        <option value="openrouter">OpenRouter</option>
                        <option value="huggingface">Hugging Face</option>
                        <option value="local">Local (Ollama)</option>
                        <option value="azure">Azure OpenAI</option>
                        <option value="gcp">Google Cloud</option>
                        <option value="custom_http">Custom HTTP</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Model</label>
                      {catalogModels.length > 0 ? (
                        <select
                          className="select"
                          value={catalogModels.some((m) => m.id === model) ? model : catalogModels[0]?.id ?? ""}
                          onChange={(e) => setModel(e.target.value)}
                        >
                          {catalogModels.map((m) => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </select>
                      ) : (
                        <input className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. model-id (no catalog for this provider)" />
                      )}
                    </div>
                    <div className="field">
                      <label>Context length (tokens)</label>
                      <input
                        className="input"
                        type="number"
                        min={1}
                        step={1000}
                        value={contextLengthInput}
                        onChange={(e) => setContextLengthInput(e.target.value)}
                        placeholder={selectedCatalogModel?.contextLength != null ? `Default for model: ${selectedCatalogModel.contextLength.toLocaleString()}` : "e.g. 128000 (optional)"}
                      />
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                        Max context window for this model. Used to cap workflow memory and RAG.
                      </span>
                    </div>
                    {!PROVIDERS_WITHOUT_ENDPOINT.includes(provider) && (
                      <div className="field">
                        <label>Endpoint</label>
                        <input className="input" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://api.openai.com/v1" />
                      </div>
                    )}
                    {provider !== "local" && (
                      <div className="field">
                        <label>API Key</label>
                        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0 0 0.35rem 0" }}>
                          Current key is stored but not shown. Enter a new key below to change it, or leave blank to keep the current one.
                        </p>
                        <input
                          className="input"
                          type="password"
                          autoComplete="new-password"
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          placeholder="Enter new API key to replace current"
                          aria-label="New API key (optional)"
                        />
                      </div>
                    )}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                      <div className="field">
                        <label>Rate limit: requests/min</label>
                        <input
                          className="input"
                          type="number"
                          min={1}
                          value={rateLimitRPM}
                          onChange={(e) => setRateLimitRPM(e.target.value)}
                          placeholder={defaultLimits[provider]?.requestsPerMinute != null ? `Default: ${defaultLimits[provider].requestsPerMinute}` : "Default by provider"}
                        />
                      </div>
                      <div className="field">
                        <label>Rate limit: tokens/min</label>
                        <input
                          className="input"
                          type="number"
                          min={0}
                          value={rateLimitTPM}
                          onChange={(e) => setRateLimitTPM(e.target.value)}
                          placeholder={defaultLimits[provider]?.tokensPerMinute != null ? `Default: ${defaultLimits[provider].tokensPerMinute}` : "Optional"}
                        />
                      </div>
                    </div>
                    <button type="submit" className="button" disabled={saving || !model.trim()}>
                      {saving ? "Saving..." : "Save changes"}
                    </button>
                  </form>
                </div>
              ) : (
                <div className="card" style={{ padding: "0.75rem 1rem" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: 8,
                        background: "var(--surface-muted)", border: "1px solid var(--border)",
                        display: "grid", placeItems: "center",
                        fontSize: "0.7rem", fontWeight: 700, color: "var(--text-muted)",
                      }}>
                        {p.provider.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>{providerLabel(p.provider)}</div>
                        <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                          {p.model}
                          {!PROVIDERS_WITHOUT_ENDPOINT.includes(p.provider) && p.endpoint ? ` · ${p.endpoint}` : ""}
                          {(p.extra?.rateLimit?.requestsPerMinute != null || defaultLimits[p.provider]?.requestsPerMinute != null) && (
                            <span style={{ display: "block", fontSize: "0.72rem", marginTop: "0.2rem" }}>
                              Rate limit: {p.extra?.rateLimit?.requestsPerMinute ?? defaultLimits[p.provider]?.requestsPerMinute} RPM
                              {(p.extra?.rateLimit?.tokensPerMinute ?? defaultLimits[p.provider]?.tokensPerMinute) != null && (
                                <> \u00B7 {(p.extra?.rateLimit?.tokensPerMinute ?? defaultLimits[p.provider]?.tokensPerMinute)?.toLocaleString()} TPM</>
                              )}
                            </span>
                          )}
                          {p.provider === "openrouter" && (() => {
                            const info = openrouterKeyInfo[p.id];
                            if (!info) return null;
                            if (info.loading) return <span style={{ display: "block", fontSize: "0.72rem", marginTop: "0.2rem", color: "var(--text-muted)" }}>Credits: loading…</span>;
                            if (info.error) {
                              return (
                                <span style={{ display: "block", fontSize: "0.72rem", marginTop: "0.2rem", color: "#dc2626" }}>
                                  Credits: {info.error}
                                  {info.hint && (
                                    <span style={{ display: "block", marginTop: "0.25rem", color: "var(--text-muted)", fontSize: "0.7rem" }}>
                                      {info.hint}
                                    </span>
                                  )}
                                </span>
                              );
                            }
                            const d = info.data?.data;
                            if (!d) return null;
                            const parts: string[] = [];
                            if (d.limit_remaining != null) parts.push(`${d.limit_remaining} credits left`);
                            else if (d.limit != null) parts.push(`limit ${d.limit}`);
                            if (d.usage_daily != null && d.usage_daily > 0) parts.push(`$${d.usage_daily.toFixed(2)} today`);
                            if (d.is_free_tier) parts.push("Free tier");
                            if (parts.length === 0) parts.push("Unlimited");
                            return <span style={{ display: "block", fontSize: "0.72rem", marginTop: "0.2rem", color: "var(--text-muted)" }}>OpenRouter: {parts.join(" · ")}</span>;
                          })()}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                      {testResult[p.id] && (
                        <span style={{
                          fontSize: "0.72rem", fontWeight: 500,
                          color: testResult[p.id].ok ? "#16a34a" : "#dc2626",
                          marginRight: "0.3rem",
                        }}>
                          {testResult[p.id].msg}
                        </span>
                      )}
                      <button
                        type="button"
                        className="button button-ghost button-small"
                        onClick={() => testProvider(p)}
                        disabled={testingId === p.id}
                      >
                        {testingId === p.id ? "..." : "Test"}
                      </button>
                      <button
                        type="button"
                        className="button button-ghost button-small"
                        onClick={() => startEdit(p)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="button button-ghost button-small"
                        onClick={() => deleteProvider(p.id)}
                        style={{ color: "#dc2626" }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
