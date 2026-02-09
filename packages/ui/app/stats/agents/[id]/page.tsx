"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Run = { id: string; provider: string; model: string; promptTokens: number; completionTokens: number; estimatedCost: number; createdAt: number };
type DayData = { date: string; promptTokens: number; completionTokens: number; cost: number; count: number };

const fmt = (n: number) => n.toLocaleString();
const fmtCost = (n: number) => `$${n.toFixed(4)}`;

export default function AgentStatsPage() {
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<{ agent: { id: string; name: string }; summary: { totalRuns: number; promptTokens: number; completionTokens: number; totalTokens: number; estimatedCost: number }; timeSeries: DayData[]; runs: Run[] } | null>(null);

  useEffect(() => {
    fetch(`/api/stats/agents/${id}`).then((r) => r.json()).then(setData);
  }, [id]);

  if (!data) return <div style={{ padding: "2rem", color: "var(--text-muted)" }}>Loading...</div>;

  const timeSeries = Array.isArray(data.timeSeries) ? data.timeSeries : [];
  const runs = Array.isArray(data.runs) ? data.runs : [];
  const maxDay = Math.max(...timeSeries.map((d) => d.promptTokens + d.completionTokens), 1);

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1.25rem" }}>
        <Link href="/stats" style={{ fontSize: "0.82rem", color: "var(--text-muted)", textDecoration: "none" }}>&larr; Statistics</Link>
        <span style={{ color: "var(--text-muted)" }}>/</span>
        <h1 style={{ margin: 0, fontSize: "1.2rem" }}>{data.agent.name}</h1>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.6rem", marginBottom: "1.5rem" }}>
        {[
          { label: "Total Calls", value: fmt(data.summary.totalRuns) },
          { label: "Input Tokens", value: fmt(data.summary.promptTokens) },
          { label: "Output Tokens", value: fmt(data.summary.completionTokens) },
          { label: "Est. Cost", value: fmtCost(data.summary.estimatedCost) },
        ].map((c) => (
          <div key={c.label} className="card" style={{ padding: "0.75rem 0.85rem" }}>
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: 500, marginBottom: "0.2rem" }}>{c.label}</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Daily chart */}
      {timeSeries.length > 0 && (
        <div style={{ marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "0.95rem", margin: "0 0 0.6rem" }}>Daily Usage</h2>
          <div className="card" style={{ padding: "0.75rem 0.85rem" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
              {timeSeries.slice(-14).map((d) => (
                <div key={d.date} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", width: 70, flexShrink: 0 }}>{d.date.slice(5)}</span>
                  <div style={{ flex: 1, display: "flex", height: 10, borderRadius: 3, overflow: "hidden", background: "var(--border)" }}>
                    <div style={{ width: `${(d.promptTokens / maxDay) * 100}%`, background: "var(--primary)", height: "100%" }} />
                    <div style={{ width: `${(d.completionTokens / maxDay) * 100}%`, background: "var(--primary-strong)", height: "100%" }} />
                  </div>
                  <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", width: 55, textAlign: "right", flexShrink: 0 }}>
                    {fmt(d.promptTokens + d.completionTokens)}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem", fontSize: "0.7rem", color: "var(--text-muted)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--primary)" }} /> Input
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--primary-strong)" }} /> Output
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Recent runs */}
      <h2 style={{ fontSize: "0.95rem", margin: "0 0 0.6rem" }}>Recent Calls</h2>
      {runs.length === 0 ? (
        <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>No calls recorded.</p>
      ) : (
        <div style={{ display: "grid", gap: "0.3rem" }}>
          {runs.map((r) => (
            <div key={r.id} className="card" style={{ padding: "0.5rem 0.75rem", fontSize: "0.8rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div style={{ display: "flex", gap: "0.75rem" }}>
                  <span style={{ fontWeight: 500 }}>{r.model}</span>
                  <span style={{ color: "var(--text-muted)" }}>{fmt(r.promptTokens)} in / {fmt(r.completionTokens)} out</span>
                </div>
                <div style={{ display: "flex", gap: "0.75rem", color: "var(--text-muted)" }}>
                  <span>{fmtCost(r.estimatedCost)}</span>
                  <span>{new Date(r.createdAt).toLocaleString()}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
