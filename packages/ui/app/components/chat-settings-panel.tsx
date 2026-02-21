"use client";

import { useState, useEffect, useCallback } from "react";
import { Settings2, RotateCcw, Sparkles } from "lucide-react";

type ChatSettings = {
  customSystemPrompt: string | null;
  contextAgentIds: string[] | null;
  contextWorkflowIds: string[] | null;
  contextToolIds: string[] | null;
  recentSummariesCount: number | null;
  temperature: number | null;
  historyCompressAfter: number | null;
  historyKeepRecent: number | null;
  plannerRecentMessages: number | null;
};

type Resource = { id: string; name: string };

type Props = {
  open: boolean;
  onClose: () => void;
  onRefreshed?: () => void;
};

export default function ChatSettingsPanel({ open, onClose, onRefreshed }: Props) {
  const [settings, setSettings] = useState<ChatSettings | null>(null);
  const [agents, setAgents] = useState<Resource[]>([]);
  const [workflows, setWorkflows] = useState<Resource[]>([]);
  const [tools, setTools] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refining, setRefining] = useState(false);
  const [customPromptDraft, setCustomPromptDraft] = useState("");
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set());
  const [selectedWorkflowIds, setSelectedWorkflowIds] = useState<Set<string>>(new Set());
  const [selectedToolIds, setSelectedToolIds] = useState<Set<string>>(new Set());
  const [useAllContext, setUseAllContext] = useState(true);
  const [recentSummariesCount, setRecentSummariesCount] = useState(3);
  const [temperature, setTemperature] = useState(0.7);
  const [historyCompressAfter, setHistoryCompressAfter] = useState(24);
  const [historyKeepRecent, setHistoryKeepRecent] = useState(16);
  const [plannerRecentMessages, setPlannerRecentMessages] = useState(12);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRes, agentsRes, workflowsRes, toolsRes] = await Promise.all([
        fetch("/api/chat/settings"),
        fetch("/api/agents"),
        fetch("/api/workflows"),
        fetch("/api/tools"),
      ]);
      const s = await settingsRes.json();
      setSettings(s);
      setCustomPromptDraft(s.customSystemPrompt ?? "");
      setUseAllContext(
        !s.contextAgentIds?.length && !s.contextWorkflowIds?.length && !s.contextToolIds?.length
      );
      setSelectedAgentIds(new Set(s.contextAgentIds ?? []));
      setSelectedWorkflowIds(new Set(s.contextWorkflowIds ?? []));
      setSelectedToolIds(new Set(s.contextToolIds ?? []));
      setRecentSummariesCount(
        typeof s.recentSummariesCount === "number"
          ? Math.min(10, Math.max(1, s.recentSummariesCount))
          : 3
      );
      const t = typeof s.temperature === "number" ? Math.min(2, Math.max(0, s.temperature)) : 0.7;
      setTemperature(Number.isNaN(t) ? 0.7 : t);
      setHistoryCompressAfter(
        typeof s.historyCompressAfter === "number"
          ? Math.min(200, Math.max(10, s.historyCompressAfter))
          : 24
      );
      setHistoryKeepRecent(
        typeof s.historyKeepRecent === "number"
          ? Math.min(100, Math.max(5, s.historyKeepRecent))
          : 16
      );
      setPlannerRecentMessages(
        typeof s.plannerRecentMessages === "number"
          ? Math.min(100, Math.max(1, s.plannerRecentMessages))
          : 12
      );

      const agentsData = await agentsRes.json();
      const workflowsData = await workflowsRes.json();
      const toolsData = await toolsRes.json();
      setAgents(
        Array.isArray(agentsData)
          ? agentsData.map((a: { id: string; name: string }) => ({ id: a.id, name: a.name }))
          : []
      );
      setWorkflows(
        Array.isArray(workflowsData)
          ? workflowsData.map((w: { id: string; name: string }) => ({ id: w.id, name: w.name }))
          : []
      );
      setTools(
        Array.isArray(toolsData)
          ? toolsData.map((t: { id: string; name: string }) => ({ id: t.id, name: t.name }))
          : []
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const save = async (updates: Partial<ChatSettings>) => {
    setSaving(true);
    try {
      await fetch("/api/chat/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      setSettings((prev) => (prev ? { ...prev, ...updates } : null));
      onRefreshed?.();
    } finally {
      setSaving(false);
    }
  };

  const handleRestoreStandard = () => {
    setCustomPromptDraft("");
    save({ customSystemPrompt: null });
  };

  const handleSavePrompt = () => {
    const trimmed = customPromptDraft.trim() || null;
    save({ customSystemPrompt: trimmed });
  };

  const handleSaveContext = () => {
    save({
      contextAgentIds: useAllContext ? null : [...selectedAgentIds],
      contextWorkflowIds: useAllContext ? null : [...selectedWorkflowIds],
      contextToolIds: useAllContext ? null : [...selectedToolIds],
    });
    onRefreshed?.();
  };

  const toggleAgent = (id: string) => {
    const next = new Set(selectedAgentIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedAgentIds(next);
  };
  const toggleWorkflow = (id: string) => {
    const next = new Set(selectedWorkflowIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedWorkflowIds(next);
  };
  const toggleTool = (id: string) => {
    const next = new Set(selectedToolIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedToolIds(next);
  };

  const handleImproveFromFeedback = async () => {
    setRefining(true);
    try {
      const res = await fetch("/api/chat/refine-prompt", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      const suggested = data.suggestedPrompt;
      if (typeof suggested === "string" && suggested.trim()) {
        setCustomPromptDraft(suggested.trim());
      }
    } finally {
      setRefining(false);
    }
  };

  if (!open) return null;

  return (
    <div className="chat-settings-panel">
      <div className="chat-settings-header">
        <span>Assistant Settings</span>
        <button type="button" className="chat-settings-close" onClick={onClose} title="Close">
          ×
        </button>
      </div>
      {loading ? (
        <div className="chat-settings-loading">Loading…</div>
      ) : (
        <div className="chat-settings-content">
          <section className="chat-settings-section">
            <h3>System prompt</h3>
            <p className="chat-settings-hint">
              Override the default system prompt. Leave empty to use the standard prompt.
            </p>
            <textarea
              className="chat-settings-textarea"
              value={customPromptDraft}
              onChange={(e) => setCustomPromptDraft(e.target.value)}
              placeholder="Custom instructions for the assistant…"
              rows={6}
            />
            <div className="chat-settings-actions">
              <button
                type="button"
                className="chat-settings-btn chat-settings-btn-secondary"
                onClick={handleRestoreStandard}
                disabled={saving}
              >
                <RotateCcw size={14} />
                Restore standard
              </button>
              <button
                type="button"
                className="chat-settings-btn chat-settings-btn-primary"
                onClick={handleSavePrompt}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save prompt"}
              </button>
            </div>
          </section>

          <section className="chat-settings-section">
            <h3>Improve from feedback</h3>
            <p className="chat-settings-hint">
              Use rated conversations to suggest prompt improvements.
            </p>
            <button
              type="button"
              className="chat-settings-btn chat-settings-btn-secondary"
              onClick={handleImproveFromFeedback}
              disabled={refining}
            >
              <Sparkles size={14} />
              {refining ? "Improving…" : "Improve from feedback"}
            </button>
          </section>

          <section className="chat-settings-section">
            <h3>Temperature</h3>
            <p className="chat-settings-hint">
              LLM sampling temperature (0–2). Lower = more focused; higher = more varied. Default
              0.7. Some models only support 1.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <input
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={temperature}
                onChange={(e) =>
                  setTemperature(Math.min(2, Math.max(0, parseFloat(e.target.value) || 0.7)))
                }
                style={{ width: "4rem", padding: "0.35rem" }}
              />
              <button
                type="button"
                className="chat-settings-btn chat-settings-btn-secondary"
                onClick={() => save({ temperature })}
                disabled={saving}
              >
                Save
              </button>
            </div>
          </section>

          <section className="chat-settings-section">
            <h3>Conversation history compression</h3>
            <p className="chat-settings-hint">
              When a chat has more than this many messages, older ones are summarized so the
              assistant keeps context without exceeding limits. Keep recent: how many of the latest
              messages to leave in full. Compress after should be greater than keep recent.
              Defaults: 24 and 16.
            </p>
            <div
              style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}
            >
              <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                <span style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>
                  Compress after
                </span>
                <input
                  type="number"
                  min={10}
                  max={200}
                  value={historyCompressAfter}
                  onChange={(e) =>
                    setHistoryCompressAfter(
                      Math.min(200, Math.max(10, parseInt(e.target.value, 10) || 24))
                    )
                  }
                  style={{ width: "4rem", padding: "0.35rem" }}
                />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                <span style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>Keep recent</span>
                <input
                  type="number"
                  min={5}
                  max={100}
                  value={historyKeepRecent}
                  onChange={(e) =>
                    setHistoryKeepRecent(
                      Math.min(100, Math.max(5, parseInt(e.target.value, 10) || 16))
                    )
                  }
                  style={{ width: "4rem", padding: "0.35rem" }}
                />
              </label>
              <button
                type="button"
                className="chat-settings-btn chat-settings-btn-secondary"
                onClick={() => save({ historyCompressAfter, historyKeepRecent })}
                disabled={saving}
              >
                Save
              </button>
            </div>
          </section>

          <section className="chat-settings-section">
            <h3>Planner context (heap mode)</h3>
            <p className="chat-settings-hint">
              Number of past messages to include in recent conversation for the planner. Higher
              values give the planner more context (e.g. URLs, intent). Default 12.
            </p>
            <div
              style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}
            >
              <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                <span style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>
                  Past messages
                </span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={plannerRecentMessages}
                  onChange={(e) =>
                    setPlannerRecentMessages(
                      Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 12))
                    )
                  }
                  style={{ width: "4rem", padding: "0.35rem" }}
                />
              </label>
              <button
                type="button"
                className="chat-settings-btn chat-settings-btn-secondary"
                onClick={() => save({ plannerRecentMessages })}
                disabled={saving}
              >
                Save
              </button>
            </div>
          </section>

          <section className="chat-settings-section">
            <h3>Cross-chat context</h3>
            <p className="chat-settings-hint">
              Number of recent conversation summaries to include in context (1–10). Default 3. Lower
              = faster, less history; higher = more continuity across chats.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <input
                type="number"
                min={1}
                max={10}
                value={recentSummariesCount}
                onChange={(e) =>
                  setRecentSummariesCount(
                    Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 3))
                  )
                }
                style={{ width: "4rem", padding: "0.35rem" }}
              />
              <span style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>
                recent summaries
              </span>
              <button
                type="button"
                className="chat-settings-btn chat-settings-btn-secondary"
                onClick={() => save({ recentSummariesCount })}
                disabled={saving}
              >
                Save
              </button>
            </div>
          </section>

          <section className="chat-settings-section">
            <h3>Context selection</h3>
            <p className="chat-settings-hint">
              Choose which agents, workflows, and tools to include in the assistant context. Include
              all = assistant sees everything.
            </p>
            <label className="chat-settings-check">
              <input
                type="checkbox"
                checked={useAllContext}
                onChange={(e) => setUseAllContext(e.target.checked)}
              />
              Include all (current behavior)
            </label>
            {!useAllContext && (
              <>
                <div className="chat-settings-subsection">
                  <h4>Agents</h4>
                  <div className="chat-settings-checklist">
                    {agents.map((a) => (
                      <label key={a.id} className="chat-settings-check">
                        <input
                          type="checkbox"
                          checked={selectedAgentIds.has(a.id)}
                          onChange={() => toggleAgent(a.id)}
                        />
                        {a.name}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="chat-settings-subsection">
                  <h4>Workflows</h4>
                  <div className="chat-settings-checklist">
                    {workflows.map((w) => (
                      <label key={w.id} className="chat-settings-check">
                        <input
                          type="checkbox"
                          checked={selectedWorkflowIds.has(w.id)}
                          onChange={() => toggleWorkflow(w.id)}
                        />
                        {w.name}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="chat-settings-subsection">
                  <h4>Tools</h4>
                  <div className="chat-settings-checklist">
                    {tools.map((t) => (
                      <label key={t.id} className="chat-settings-check">
                        <input
                          type="checkbox"
                          checked={selectedToolIds.has(t.id)}
                          onChange={() => toggleTool(t.id)}
                        />
                        {t.name}
                      </label>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  className="chat-settings-btn chat-settings-btn-primary"
                  onClick={handleSaveContext}
                  disabled={saving}
                >
                  Save context selection
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
