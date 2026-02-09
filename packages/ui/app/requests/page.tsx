"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type LLMRequestContext = {
  source: "chat" | "workflow" | "agent";
  workflowId?: string;
  executionId?: string;
  agentId?: string;
};

type PendingEntry = {
  id: string;
  key: string;
  context: LLMRequestContext;
  addedAt: number;
};

type DelayedEntry = {
  key: string;
  context: LLMRequestContext;
  addedAt: number;
  completedAt: number;
  waitedMs: number;
};

type QueueData = {
  pending: PendingEntry[];
  recentDelayed: DelayedEntry[];
};

type AggregateBy = "none" | "source" | "workflow" | "agent";

function formatTs(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour12: false }) + "." + (ts % 1000).toString().padStart(3, "0");
}

function describeContext(ctx: LLMRequestContext): string {
  const parts: string[] = [ctx.source];
  if (ctx.workflowId) parts.push(`workflow ${ctx.workflowId.slice(0, 8)}…`);
  if (ctx.agentId) parts.push(`agent ${ctx.agentId.slice(0, 8)}…`);
  return parts.join(" | ");
}

function groupPending(pending: PendingEntry[], by: AggregateBy): Map<string, PendingEntry[]> {
  const map = new Map<string, PendingEntry[]>();
  for (const p of pending) {
    let key: string;
    if (by === "source") key = p.context.source;
    else if (by === "workflow") key = p.context.workflowId ?? "(no workflow)";
    else if (by === "agent") key = p.context.agentId ?? "(no agent)";
    else key = p.id;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  return map;
}

function groupDelayed(delayed: DelayedEntry[], by: AggregateBy): Map<string, DelayedEntry[]> {
  const map = new Map<string, DelayedEntry[]>();
  for (const d of delayed) {
    let key: string;
    if (by === "source") key = d.context.source;
    else if (by === "workflow") key = d.context.workflowId ?? "(no workflow)";
    else if (by === "agent") key = d.context.agentId ?? "(no agent)";
    else key = `${d.addedAt}-${d.key}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(d);
  }
  return map;
}

export default function RequestsPage() {
  const [data, setData] = useState<QueueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [aggregateBy, setAggregateBy] = useState<AggregateBy>("none");

  useEffect(() => {
    const fetchQueue = async () => {
      try {
        const res = await fetch("/api/rate-limit/queue");
        if (res.ok) {
          const json = await res.json();
          setData({
            pending: Array.isArray(json.pending) ? json.pending : [],
            recentDelayed: Array.isArray(json.recentDelayed) ? json.recentDelayed : [],
          });
        } else {
          setData({ pending: [], recentDelayed: [] });
        }
      } catch {
        setData({ pending: [], recentDelayed: [] });
      } finally {
        setLoading(false);
      }
    };
    fetchQueue();
    const interval = setInterval(fetchQueue, 2000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !data) {
    return (
      <div style={{ padding: "2rem", color: "var(--text-muted)" }}>
        Loading request queue…
      </div>
    );
  }

  const pending = data?.pending ?? [];
  const recentDelayed = data?.recentDelayed ?? [];

  const pendingGrouped = groupPending(pending, aggregateBy);
  const delayedGrouped = groupDelayed(recentDelayed, aggregateBy);

  return (
    <div style={{ maxWidth: 900 }}>
      <h1 style={{ margin: "0 0 0.25rem" }}>Request queue</h1>
      <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0 0 1rem" }}>
        LLM requests waiting due to rate limiting, and recently delayed requests. Data updates every 2 seconds.
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Aggregate by:</span>
        {(["none", "source", "workflow", "agent"] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={`tab ${aggregateBy === value ? "tab-active" : ""}`}
            onClick={() => setAggregateBy(value)}
          >
            {value === "none" ? "None" : value === "source" ? "Source" : value === "workflow" ? "Workflow" : "Agent"}
          </button>
        ))}
      </div>

      <section className="card" style={{ padding: "1rem", marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "0.95rem", margin: "0 0 0.5rem" }}>
          Waiting now
          {pending.length > 0 && (
            <span style={{ marginLeft: "0.5rem", fontWeight: 600, color: "var(--resource-yellow)" }}>
              {pending.length} request{pending.length !== 1 ? "s" : ""}
            </span>
          )}
        </h2>
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0 0 0.75rem" }}>
          Requests currently blocked by rate limits (RPM/TPM) until a slot is free.
        </p>
        {pending.length === 0 ? (
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>No requests waiting.</p>
        ) : aggregateBy === "none" ? (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {pending.map((p) => (
              <li
                key={p.id}
                style={{
                  padding: "0.5rem 0.6rem",
                  borderRadius: 6,
                  background: "var(--surface-muted)",
                  marginBottom: "0.35rem",
                  fontSize: "0.85rem",
                }}
              >
                <span style={{ color: "var(--text-muted)", marginRight: "0.5rem" }}>{formatTs(p.addedAt)}</span>
                <span>{describeContext(p.context)}</span>
                <span style={{ color: "var(--text-muted)", marginLeft: "0.5rem" }}>{" | "}{p.key}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {Array.from(pendingGrouped.entries()).map(([key, entries]) => (
              <div key={key}>
                <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.35rem", color: "var(--text-muted)" }}>
                  {aggregateBy === "workflow" && key !== "(no workflow)" ? (
                    <Link href={`/workflows/${key}`} style={{ color: "var(--primary)" }}>{key}</Link>
                  ) : aggregateBy === "agent" && key !== "(no agent)" ? (
                    <Link href={`/agents/${key}`} style={{ color: "var(--primary)" }}>{key}</Link>
                  ) : (
                    key
                  )}
                  {" "}({entries.length})
                </div>
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {entries.map((p) => (
                    <li
                      key={p.id}
                      style={{
                        padding: "0.4rem 0.5rem",
                        borderRadius: 4,
                        background: "var(--surface-muted)",
                        marginBottom: "0.25rem",
                        fontSize: "0.82rem",
                      }}
                    >
                      {formatTs(p.addedAt)} — {describeContext(p.context)} | {p.key}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card" style={{ padding: "1rem" }}>
        <h2 style={{ fontSize: "0.95rem", margin: "0 0 0.5rem" }}>Recently delayed</h2>
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0 0 0.75rem" }}>
          Requests that had to wait at least 50ms before being sent (last 200 shown).
        </p>
        {recentDelayed.length === 0 ? (
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>No delayed requests in history.</p>
        ) : aggregateBy === "none" ? (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {[...recentDelayed].reverse().slice(0, 50).map((d, i) => (
              <li
                key={`${d.addedAt}-${d.key}-${i}`}
                style={{
                  padding: "0.45rem 0.6rem",
                  borderRadius: 6,
                  background: "var(--surface-muted)",
                  marginBottom: "0.35rem",
                  fontSize: "0.85rem",
                }}
              >
                <span style={{ color: "var(--text-muted)", marginRight: "0.5rem" }}>{formatTs(d.completedAt)}</span>
                <span>{describeContext(d.context)}</span>
                <span style={{ marginLeft: "0.5rem", color: "var(--resource-yellow)" }}>waited {d.waitedMs}ms</span>
                <span style={{ color: "var(--text-muted)", marginLeft: "0.5rem" }}>{" | "}{d.key}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {Array.from(delayedGrouped.entries()).map(([key, entries]) => (
              <div key={key}>
                <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.35rem", color: "var(--text-muted)" }}>
                  {aggregateBy === "workflow" && key !== "(no workflow)" ? (
                    <Link href={`/workflows/${key}`} style={{ color: "var(--primary)" }}>{key}</Link>
                  ) : aggregateBy === "agent" && key !== "(no agent)" ? (
                    <Link href={`/agents/${key}`} style={{ color: "var(--primary)" }}>{key}</Link>
                  ) : (
                    key
                  )}
                  {" "}({entries.length})
                </div>
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {entries.slice(-15).reverse().map((d, i) => (
                    <li
                      key={`${d.addedAt}-${d.key}-${i}`}
                      style={{
                        padding: "0.4rem 0.5rem",
                        borderRadius: 4,
                        background: "var(--surface-muted)",
                        marginBottom: "0.25rem",
                        fontSize: "0.82rem",
                      }}
                    >
                      {formatTs(d.completedAt)} — {describeContext(d.context)} — waited {d.waitedMs}ms | {d.key}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
