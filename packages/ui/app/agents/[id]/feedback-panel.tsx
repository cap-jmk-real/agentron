"use client";

import { useEffect, useState } from "react";
import { ThumbsUp, ThumbsDown, Sparkles, Trash2 } from "lucide-react";

type FeedbackEntry = {
  id: string;
  label: "good" | "bad";
  input: unknown;
  output: unknown;
  notes?: string;
  createdAt: number;
};

type RefineResult = {
  suggestedSystemPrompt: string;
  suggestedSteps?: { name: string; type: string; content: string }[];
  reasoning: string;
};

type Props = {
  agentId: string;
  onApplyRefinement?: (
    systemPrompt: string,
    steps?: { name: string; type: string; content: string }[]
  ) => void;
};

export default function FeedbackPanel({ agentId, onApplyRefinement }: Props) {
  const [items, setItems] = useState<FeedbackEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refining, setRefining] = useState(false);
  const [refineResult, setRefineResult] = useState<RefineResult | null>(null);

  const load = () => {
    setLoading(true);
    fetch(`/api/feedback?targetId=${agentId}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setItems(data);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [agentId]);

  const removeFeedback = async (id: string) => {
    await fetch(`/api/feedback/${id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((f) => f.id !== id));
  };

  const refinePrompt = async () => {
    setRefining(true);
    setRefineResult(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/refine`, { method: "POST" });
      const data = await res.json();
      if (data.error) {
        alert(data.error);
      } else {
        setRefineResult(data);
      }
    } finally {
      setRefining(false);
    }
  };

  const applyRefinement = () => {
    if (refineResult && onApplyRefinement) {
      onApplyRefinement(refineResult.suggestedSystemPrompt, refineResult.suggestedSteps);
      setRefineResult(null);
    }
  };

  const goodCount = items.filter((f) => f.label === "good").length;
  const badCount = items.filter((f) => f.label === "bad").length;

  if (loading)
    return (
      <div className="card">
        <p style={{ color: "var(--text-muted)" }}>Loading feedback...</p>
      </div>
    );

  return (
    <div className="card">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "0.75rem",
        }}
      >
        <div>
          <h3 style={{ margin: 0 }}>Feedback &amp; Learning</h3>
          <p style={{ margin: "0.1rem 0 0", fontSize: "0.78rem", color: "var(--text-muted)" }}>
            Label agent outputs to improve performance over time.
          </p>
        </div>
        <button
          className="button button-small"
          onClick={refinePrompt}
          disabled={refining || items.length === 0}
        >
          <Sparkles size={13} /> {refining ? "Refining..." : "Refine Prompt"}
        </button>
      </div>

      <div className="feedback-stats">
        <div className="feedback-stat">
          <ThumbsUp size={14} style={{ color: "#16a34a" }} /> {goodCount} good
        </div>
        <div className="feedback-stat">
          <ThumbsDown size={14} style={{ color: "#dc2626" }} /> {badCount} bad
        </div>
        <div className="feedback-stat" style={{ color: "var(--text-muted)", fontWeight: 400 }}>
          {items.length} total
        </div>
      </div>

      {refineResult && (
        <div
          style={{
            marginBottom: "0.75rem",
            padding: "0.75rem",
            borderRadius: "6px",
            border: "1px solid var(--primary)",
            background: "var(--sidebar-active-bg)",
          }}
        >
          <div className="section-label">Suggested Improvement</div>
          <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: "0 0 0.5rem" }}>
            {refineResult.reasoning}
          </p>
          <textarea
            className="textarea"
            rows={4}
            value={refineResult.suggestedSystemPrompt}
            readOnly
            style={{ marginBottom: "0.5rem", fontSize: "0.78rem" }}
          />
          <button className="button button-small" onClick={applyRefinement}>
            Apply to Agent
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="empty-state">
          <p style={{ fontSize: "0.88rem" }}>No feedback yet</p>
          <p style={{ fontSize: "0.78rem" }}>
            Run the agent and label outputs as good or bad to start learning.
          </p>
        </div>
      ) : (
        <div className="feedback-list">
          {items.map((fb) => (
            <div key={fb.id} className="feedback-item">
              <div className="feedback-item-header">
                <span className={`feedback-label feedback-label-${fb.label}`}>
                  {fb.label === "good" ? <ThumbsUp size={10} /> : <ThumbsDown size={10} />}
                  {fb.label}
                </span>
                <button
                  className="step-action-btn"
                  onClick={() => removeFeedback(fb.id)}
                  title="Remove"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="feedback-io">
                In: {typeof fb.input === "string" ? fb.input : JSON.stringify(fb.input)}
              </div>
              <div className="feedback-io">
                Out: {typeof fb.output === "string" ? fb.output : JSON.stringify(fb.output)}
              </div>
              {fb.notes && (
                <div style={{ fontSize: "0.75rem", color: "var(--text)" }}>Note: {fb.notes}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
