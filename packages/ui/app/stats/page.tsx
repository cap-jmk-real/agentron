"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BarChart3, Cpu, MemoryStick, HardDrive, Gauge } from "lucide-react";
import { ResourceBar, usageBarColor } from "../components/resource-bar";
import {
  getSystemStatsIntervalMs,
  setSystemStatsIntervalMs,
  SYSTEM_STATS_INTERVAL_MIN_MS,
  SYSTEM_STATS_INTERVAL_MAX_MS,
  SYSTEM_STATS_INTERVAL_DEFAULT_MS,
  SYSTEM_STATS_INTERVAL_STEP_MS,
  formatSystemStatsInterval,
  SYSTEM_STATS_INTERVAL_CHANGED_EVENT,
} from "../lib/system-stats-interval";

type AgentStat = {
  id: string;
  name: string;
  totalRuns: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
};

type ChatStat = {
  totalRuns: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
};

type Totals = ChatStat;

type WorkflowStat = {
  id: string;
  name: string;
  totalRuns: number;
  totalTokens: number;
  estimatedCost: number;
};

const fmt = (n: number) => n.toLocaleString();
const fmtCost = (n: number) => `$${n.toFixed(4)}`;

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div
      style={{
        width: "100%",
        height: 6,
        borderRadius: 3,
        background: "var(--border)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          borderRadius: 3,
          background: color,
          transition: "width 300ms ease",
        }}
      />
    </div>
  );
}

type ResourceSnapshot = {
  ts: number;
  ram: { total: number; free: number; used: number };
  process: { rss: number; heapUsed: number };
  cpu: { loadAvg: [number, number, number]; processUser: number; processSystem: number };
  disk: { total: number; free: number; path: string };
  gpu: { utilizationPercent: number; vramUsed: number; vramTotal: number }[];
};

const CHART_HEIGHT = 36;
const CHART_COLORS = {
  cpu: "var(--primary)",
  ram: "#6366f1",
  gpu: "#22c55e",
  vram: "#14b8a6",
  disk: "#f59e0b",
};

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2)
    return (
      <div style={{ height: CHART_HEIGHT, background: "var(--surface-muted)", borderRadius: 4 }} />
    );
  const min = Math.min(...data);
  const range = Math.max(...data) - min || 1;
  const w = 100 / (data.length - 1);
  const points = data
    .map(
      (v, i) =>
        `${(i * w).toFixed(2)},${(CHART_HEIGHT - ((v - min) / range) * CHART_HEIGHT).toFixed(2)}`
    )
    .join(" ");
  return (
    <svg
      viewBox={`0 0 100 ${CHART_HEIGHT}`}
      width="100%"
      height={CHART_HEIGHT}
      preserveAspectRatio="none"
      style={{ display: "block", borderRadius: 4, overflow: "hidden" }}
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export default function StatsPage() {
  const [activeTab, setActiveTab] = useState<"usage" | "resources">("usage");
  const [agentStats, setAgentStats] = useState<AgentStat[]>([]);
  const [workflowStats, setWorkflowStats] = useState<WorkflowStat[]>([]);
  const [chat, setChat] = useState<ChatStat | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [resourceHistory, setResourceHistory] = useState<ResourceSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [statsIntervalMs, setStatsIntervalMs] = useState(SYSTEM_STATS_INTERVAL_DEFAULT_MS);

  useEffect(() => {
    const safeJson = async (r: Response) => {
      const text = await r.text();
      if (!text.trim()) return {};
      try {
        return JSON.parse(text) as Record<string, unknown>;
      } catch {
        return {};
      }
    };
    Promise.all([
      fetch("/api/stats/agents").then((r) => safeJson(r)),
      fetch("/api/stats/workflows").then((r) => safeJson(r)),
    ])
      .then(([agentData, wfData]) => {
        setAgentStats((agentData.agents as AgentStat[] | undefined) ?? []);
        setChat((agentData.chat as ChatStat | null) ?? null);
        setTotals((agentData.totals as Totals | null) ?? null);
        setWorkflowStats((wfData.workflows as WorkflowStat[] | undefined) ?? []);
        setLoading(false);
      })
      .catch(() => {
        setAgentStats([]);
        setWorkflowStats([]);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    queueMicrotask(() => setStatsIntervalMs(getSystemStatsIntervalMs()));
    const handler = () => setStatsIntervalMs(getSystemStatsIntervalMs());
    window.addEventListener(SYSTEM_STATS_INTERVAL_CHANGED_EVENT, handler);
    return () => window.removeEventListener(SYSTEM_STATS_INTERVAL_CHANGED_EVENT, handler);
  }, []);

  useEffect(() => {
    if (activeTab !== "resources") return;
    const load = async () => {
      try {
        const r = await fetch("/api/system-stats/history");
        const text = await r.text();
        if (!text.trim()) return setResourceHistory([]);
        setResourceHistory(JSON.parse(text) as ResourceSnapshot[]);
      } catch {
        setResourceHistory([]);
      }
    };
    load();
    const id = setInterval(load, statsIntervalMs);
    return () => clearInterval(id);
  }, [activeTab, statsIntervalMs]);

  if (loading)
    return <div style={{ padding: "2rem", color: "var(--text-muted)" }}>Loading statistics...</div>;

  const maxTokens = Math.max(...agentStats.map((a) => a.totalTokens), 1);

  const ramPct = resourceHistory.map((s) =>
    s.ram.total > 0 ? (s.ram.used / s.ram.total) * 100 : 0
  );
  const cpuPct: number[] = [];
  for (let i = 0; i < resourceHistory.length; i++) {
    const s = resourceHistory[i];
    const prev = i > 0 ? resourceHistory[i - 1] : null;
    if (prev) {
      const dt = (s.ts - prev.ts) / 1000;
      if (dt > 0) {
        const du = s.cpu.processUser - prev.cpu.processUser;
        const ds = s.cpu.processSystem - prev.cpu.processSystem;
        cpuPct.push(Math.min(100, ((du + ds) / 1e6 / dt) * 100));
      } else cpuPct.push(cpuPct[cpuPct.length - 1] ?? 0);
    } else cpuPct.push(0);
  }
  const gpuPct = resourceHistory.map((s) => s.gpu[0]?.utilizationPercent ?? 0);
  const vramPct = resourceHistory.map((s) => {
    const g = s.gpu[0];
    return g && g.vramTotal > 0 ? (g.vramUsed / g.vramTotal) * 100 : 0;
  });
  const diskFreeGb = resourceHistory.map((s) => s.disk.free / 1024 ** 3);
  const latest = resourceHistory[resourceHistory.length - 1];
  const diskFreeNow = latest ? (latest.disk.free / 1024 ** 3).toFixed(1) : "—";
  const diskUsedPct =
    latest && latest.disk.total > 0
      ? Math.round((1 - latest.disk.free / latest.disk.total) * 100)
      : 0;
  const currentCpu = cpuPct.length > 0 ? cpuPct[cpuPct.length - 1] : 0;
  const currentRam = ramPct.length > 0 ? ramPct[ramPct.length - 1] : 0;
  const currentGpu = gpuPct.length > 0 ? gpuPct[gpuPct.length - 1] : 0;
  const currentVram = vramPct.length > 0 ? vramPct[vramPct.length - 1] : 0;

  return (
    <div style={{ maxWidth: 800 }}>
      <h1 style={{ margin: "0 0 0.25rem" }}>Statistics</h1>
      <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0 0 0.75rem" }}>
        {activeTab === "usage"
          ? "Token usage and cost breakdown."
          : "Live resource usage over time (sidebar polls feed this)."}
      </p>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem" }}>
        <button
          type="button"
          className={`tab ${activeTab === "usage" ? "tab-active" : ""}`}
          onClick={() => setActiveTab("usage")}
        >
          <BarChart3 size={14} /> Usage
        </button>
        <button
          type="button"
          className={`tab ${activeTab === "resources" ? "tab-active" : ""}`}
          onClick={() => setActiveTab("resources")}
        >
          <Cpu size={14} /> Resources
        </button>
      </div>

      {activeTab === "resources" && (
        <div className="card" style={{ padding: "1rem", marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "0.95rem", margin: "0 0 0.75rem" }}>Resource time series</h2>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0 0 0.5rem" }}>
            Last ~2.5 minutes. Polling uses the same interval as the sidebar (Settings → System
            stats refresh).
          </p>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              flexWrap: "wrap",
              marginBottom: "1rem",
            }}
          >
            <label style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
              Refresh interval
            </label>
            <input
              type="range"
              min={SYSTEM_STATS_INTERVAL_MIN_MS}
              max={SYSTEM_STATS_INTERVAL_MAX_MS}
              step={SYSTEM_STATS_INTERVAL_STEP_MS}
              value={statsIntervalMs}
              onChange={(e) => {
                const v = Number(e.target.value);
                setStatsIntervalMs(v);
                setSystemStatsIntervalMs(v);
              }}
              style={{ flex: "1 1 200px", minWidth: 120, accentColor: "var(--primary)" }}
            />
            <span style={{ fontSize: "0.85rem", fontWeight: 600, minWidth: 52 }}>
              {formatSystemStatsInterval(statsIntervalMs)}
            </span>
          </div>
          <div style={{ display: "grid", gap: "1rem" }}>
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  marginBottom: "0.35rem",
                  fontSize: "0.8rem",
                }}
              >
                <Cpu size={14} style={{ color: usageBarColor(currentCpu) }} />{" "}
                <span>CPU (process %)</span>
                <span
                  style={{ marginLeft: "auto", fontWeight: 600, color: usageBarColor(currentCpu) }}
                >
                  {Math.round(currentCpu)}%
                </span>
              </div>
              <ResourceBar percent={currentCpu} height={8} />
              <div style={{ marginTop: "0.35rem" }}>
                <Sparkline data={cpuPct} color={CHART_COLORS.cpu} />
              </div>
            </div>
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  marginBottom: "0.35rem",
                  fontSize: "0.8rem",
                }}
              >
                <MemoryStick size={14} style={{ color: usageBarColor(currentRam) }} />{" "}
                <span>RAM (used %)</span>
                <span
                  style={{ marginLeft: "auto", fontWeight: 600, color: usageBarColor(currentRam) }}
                >
                  {Math.round(currentRam)}%
                </span>
              </div>
              <ResourceBar percent={currentRam} height={8} />
              <div style={{ marginTop: "0.35rem" }}>
                <Sparkline data={ramPct} color={CHART_COLORS.ram} />
              </div>
            </div>
            {gpuPct.some((v) => v > 0) && (
              <>
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      marginBottom: "0.35rem",
                      fontSize: "0.8rem",
                    }}
                  >
                    <Gauge size={14} style={{ color: usageBarColor(currentGpu) }} />{" "}
                    <span>GPU utilization %</span>
                    <span
                      style={{
                        marginLeft: "auto",
                        fontWeight: 600,
                        color: usageBarColor(currentGpu),
                      }}
                    >
                      {Math.round(currentGpu)}%
                    </span>
                  </div>
                  <ResourceBar percent={currentGpu} height={8} />
                  <div style={{ marginTop: "0.35rem" }}>
                    <Sparkline data={gpuPct} color={CHART_COLORS.gpu} />
                  </div>
                </div>
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      marginBottom: "0.35rem",
                      fontSize: "0.8rem",
                    }}
                  >
                    <MemoryStick size={14} style={{ color: usageBarColor(currentVram) }} />{" "}
                    <span>VRAM used %</span>
                    <span
                      style={{
                        marginLeft: "auto",
                        fontWeight: 600,
                        color: usageBarColor(currentVram),
                      }}
                    >
                      {Math.round(currentVram)}%
                    </span>
                  </div>
                  <ResourceBar percent={currentVram} height={8} />
                  <div style={{ marginTop: "0.35rem" }}>
                    <Sparkline data={vramPct} color={CHART_COLORS.vram} />
                  </div>
                </div>
              </>
            )}
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  marginBottom: "0.35rem",
                  fontSize: "0.8rem",
                }}
              >
                <HardDrive size={14} style={{ color: usageBarColor(diskUsedPct) }} />{" "}
                <span>Disk used % — {diskFreeNow} GB free</span>
                <span
                  style={{ marginLeft: "auto", fontWeight: 600, color: usageBarColor(diskUsedPct) }}
                >
                  {diskUsedPct}%
                </span>
              </div>
              <ResourceBar percent={diskUsedPct} height={8} />
              <div style={{ marginTop: "0.35rem" }}>
                <Sparkline data={diskFreeGb} color={CHART_COLORS.disk} />
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "usage" && (
        <>
          <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0 0 1.5rem" }}>
            Token usage and cost breakdown across agents, workflows, and the chat assistant.
          </p>

          {/* Overview cards */}
          {totals && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: "0.6rem",
                marginBottom: "1.5rem",
              }}
            >
              {[
                { label: "Total Calls", value: fmt(totals.totalRuns) },
                { label: "Input Tokens", value: fmt(totals.promptTokens) },
                { label: "Output Tokens", value: fmt(totals.completionTokens) },
                { label: "Est. Cost", value: fmtCost(totals.estimatedCost) },
              ].map((card) => (
                <div key={card.label} className="card" style={{ padding: "0.75rem 0.85rem" }}>
                  <div
                    style={{
                      fontSize: "0.72rem",
                      color: "var(--text-muted)",
                      fontWeight: 500,
                      marginBottom: "0.2rem",
                    }}
                  >
                    {card.label}
                  </div>
                  <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>{card.value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Agent usage */}
          <div style={{ marginBottom: "1.5rem" }}>
            <h2 style={{ fontSize: "0.95rem", margin: "0 0 0.6rem" }}>Agents</h2>
            {agentStats.length === 0 ? (
              <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
                No agent usage recorded yet.
              </p>
            ) : (
              <div style={{ display: "grid", gap: "0.4rem" }}>
                {agentStats.map((a) => (
                  <Link
                    key={a.id}
                    href={`/stats/agents/${a.id}`}
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    <div className="card" style={{ padding: "0.65rem 0.85rem", cursor: "pointer" }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: "0.35rem",
                        }}
                      >
                        <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>{a.name}</span>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                          {fmt(a.totalTokens)} tokens &middot; {fmtCost(a.estimatedCost)}
                        </span>
                      </div>
                      <Bar value={a.totalTokens} max={maxTokens} color="var(--primary)" />
                      <div
                        style={{
                          display: "flex",
                          gap: "1rem",
                          marginTop: "0.3rem",
                          fontSize: "0.72rem",
                          color: "var(--text-muted)",
                        }}
                      >
                        <span>{fmt(a.promptTokens)} in</span>
                        <span>{fmt(a.completionTokens)} out</span>
                        <span>{a.totalRuns} calls</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Chat assistant usage */}
          {chat && chat.totalRuns > 0 && (
            <div style={{ marginBottom: "1.5rem" }}>
              <h2 style={{ fontSize: "0.95rem", margin: "0 0 0.6rem" }}>Chat Assistant</h2>
              <div className="card" style={{ padding: "0.65rem 0.85rem" }}>
                <div style={{ display: "flex", gap: "1.5rem", fontSize: "0.82rem" }}>
                  <span>
                    <strong>{fmt(chat.totalRuns)}</strong> calls
                  </span>
                  <span>
                    <strong>{fmt(chat.totalTokens)}</strong> tokens
                  </span>
                  <span>
                    <strong>{fmtCost(chat.estimatedCost)}</strong>
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Workflow usage */}
          <div>
            <h2 style={{ fontSize: "0.95rem", margin: "0 0 0.6rem" }}>Workflows</h2>
            {workflowStats.length === 0 ? (
              <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
                No workflow usage recorded yet.
              </p>
            ) : (
              <div style={{ display: "grid", gap: "0.4rem" }}>
                {workflowStats.map((wf) => (
                  <Link
                    key={wf.id}
                    href={`/stats/workflows/${wf.id}`}
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    <div className="card" style={{ padding: "0.65rem 0.85rem", cursor: "pointer" }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: "0.85rem",
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>{wf.name}</span>
                        <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
                          {fmt(wf.totalTokens)} tokens &middot; {fmtCost(wf.estimatedCost)}
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
