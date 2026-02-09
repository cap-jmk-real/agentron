"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type AgentBreakdown = { id: string; name: string; promptTokens: number; completionTokens: number; estimatedCost: number; count: number };

const fmt = (n: number) => n.toLocaleString();
const fmtCost = (n: number) => `$${n.toFixed(4)}`;

export default function WorkflowStatsPage() {
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<{
    workflow: { id: string; name: string };
    summary: { totalRuns: number; promptTokens: number; completionTokens: number; totalTokens: number; estimatedCost: number };
    agents: AgentBreakdown[];
  } | null>(null);

  useEffect(() => {
    fetch(`/api/stats/workflows/${id}`).then((r) => r.json()).then(setData);
  }, [id]);

  if (!data) return <div style={{ padding: "2rem", color: "var(--text-muted)" }}>Loading...</div>;

  const agents = Array.isArray(data.agents) ? data.agents : [];
  const maxAgent = Math.max(...agents.map((a) => a.promptTokens + a.completionTokens), 1);
  const workflow = data.workflow ?? { id: "", name: "Workflow" };
  const summary = data.summary ?? { totalRuns: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 };

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1.25rem" }}>
        <Link href="/stats" style={{ fontSize: "0.82rem", color: "var(--text-muted)", textDecoration: "none" }}>&larr; Statistics</Link>
        <span style={{ color: "var(--text-muted)" }}>/</span>
        <h1 style={{ margin: 0, fontSize: "1.2rem" }}>{workflow.name}</h1>
      </div>

      {/* Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.6rem", marginBottom: "1.5rem" }}>
        {[
          { label: "Total Calls", value: fmt(summary.totalRuns) },
          { label: "Input Tokens", value: fmt(summary.promptTokens) },
          { label: "Output Tokens", value: fmt(summary.completionTokens) },
          { label: "Est. Cost", value: fmtCost(summary.estimatedCost) },
        ].map((c) => (
          <div key={c.label} className="card" style={{ padding: "0.75rem 0.85rem" }}>
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: 500, marginBottom: "0.2rem" }}>{c.label}</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Per-agent breakdown */}
      <h2 style={{ fontSize: "0.95rem", margin: "0 0 0.6rem" }}>Agent Breakdown</h2>
      {agents.length === 0 ? (
        <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>No agent usage recorded in this workflow.</p>
      ) : (
        <div style={{ display: "grid", gap: "0.4rem" }}>
          {agents.map((a) => (
            <Link key={a.id} href={`/stats/agents/${a.id}`} style={{ textDecoration: "none", color: "inherit" }}>
              <div className="card" style={{ padding: "0.65rem 0.85rem", cursor: "pointer" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.3rem" }}>
                  <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>{a.name}</span>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    {fmt(a.promptTokens + a.completionTokens)} tokens &middot; {fmtCost(a.estimatedCost)}
                  </span>
                </div>
                <div style={{ width: "100%", height: 6, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
                  <div style={{ display: "flex", height: "100%" }}>
                    <div style={{ width: `${(a.promptTokens / maxAgent) * 100}%`, background: "var(--primary)", height: "100%" }} />
                    <div style={{ width: `${(a.completionTokens / maxAgent) * 100}%`, background: "var(--primary-strong)", height: "100%" }} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: "1rem", marginTop: "0.25rem", fontSize: "0.72rem", color: "var(--text-muted)" }}>
                  <span>{fmt(a.promptTokens)} in</span>
                  <span>{fmt(a.completionTokens)} out</span>
                  <span>{a.count} calls</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
