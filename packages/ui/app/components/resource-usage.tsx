"use client";

import { useEffect, useState, useRef } from "react";
import { Cpu, MemoryStick, HardDrive, Gauge } from "lucide-react";
import { ResourceBar } from "./resource-bar";
import { getSystemStatsIntervalMs, SYSTEM_STATS_INTERVAL_CHANGED_EVENT } from "../lib/system-stats-interval";

type SystemStats = {
  ts: number;
  ram: { total: number; free: number; used: number };
  process: { rss: number; heapUsed: number };
  cpu: { loadAvg: [number, number, number]; processUser: number; processSystem: number };
  disk: { total: number; free: number; path: string };
  gpu: { utilizationPercent: number; vramUsed: number; vramTotal: number }[];
};

function mb(bytes: number) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function gb(bytes: number) {
  return (bytes / (1024 * 1024 * 1024)).toFixed(1);
}

export function ResourceUsage() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [cpuPercent, setCpuPercent] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [intervalMs, setIntervalMs] = useState(400);
  const prevCpuRef = useRef<{ user: number; system: number; ts: number } | null>(null);

  useEffect(() => {
    queueMicrotask(() => setIntervalMs(getSystemStatsIntervalMs()));
    const handler = () => setIntervalMs(getSystemStatsIntervalMs());
    window.addEventListener(SYSTEM_STATS_INTERVAL_CHANGED_EVENT, handler);
    return () => window.removeEventListener(SYSTEM_STATS_INTERVAL_CHANGED_EVENT, handler);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      fetch("/api/system-stats")
        .then((r) => r.json())
        .then((data: SystemStats) => {
          if (cancelled) return;
          setStats(data);
          setError(false);
          const { processUser, processSystem } = data.cpu;
          const now = Date.now();
          const prev = prevCpuRef.current;
          if (prev) {
            const dt = (now - prev.ts) / 1000;
            if (dt > 0) {
              const deltaUser = processUser - prev.user;
              const deltaSystem = processSystem - prev.system;
              const totalDelta = (deltaUser + deltaSystem) / 1e6;
              setCpuPercent(Math.min(100, Math.round((totalDelta / dt) * 100)));
            }
          }
          prevCpuRef.current = { user: processUser, system: processSystem, ts: now };
        })
        .catch(() => {
          if (!cancelled) setError(true);
        });
    };
    poll();
    const id = setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intervalMs]);

  if (error || !stats) {
    return (
      <div className="resource-usage-grid">
        <span className="resource-usage-meta">{error ? "—" : "…"}</span>
      </div>
    );
  }

  const ramUsedPct = stats.ram.total > 0 ? Math.round((stats.ram.used / stats.ram.total) * 100) : 0;
  const diskFreeGb = gb(stats.disk.free);
  const diskUsedPct = stats.disk.total > 0 ? Math.round((1 - stats.disk.free / stats.disk.total) * 100) : 0;
  const gpu0 = stats.gpu[0];
  const vramUsedPct = gpu0 && gpu0.vramTotal > 0 ? Math.round((gpu0.vramUsed / gpu0.vramTotal) * 100) : null;

  return (
    <div className="resource-usage-grid" title={`RAM ${mb(stats.ram.used)} / ${mb(stats.ram.total)} MB · Process ${mb(stats.process.rss)} MB · Disk ${diskFreeGb} GB free`}>
      <div className="resource-usage-block">
        <div className="resource-usage-row">
          <Cpu size={12} className="resource-usage-icon" />
          <span className="resource-usage-value">{cpuPercent != null ? `${cpuPercent}%` : "—"}</span>
          <span className="resource-usage-label">CPU</span>
        </div>
        <ResourceBar percent={cpuPercent ?? 0} height={3} />
      </div>
      <div className="resource-usage-block">
        <div className="resource-usage-row">
          <MemoryStick size={12} className="resource-usage-icon" />
          <span className="resource-usage-value">{ramUsedPct}%</span>
          <span className="resource-usage-label">RAM</span>
        </div>
        <ResourceBar percent={ramUsedPct} height={3} />
      </div>
      {gpu0 && (
        <>
          <div className="resource-usage-block">
            <div className="resource-usage-row">
              <Gauge size={12} className="resource-usage-icon" />
              <span className="resource-usage-value">{gpu0.utilizationPercent}%</span>
              <span className="resource-usage-label">GPU</span>
            </div>
            <ResourceBar percent={gpu0.utilizationPercent} height={3} />
          </div>
          <div className="resource-usage-block">
            <div className="resource-usage-row">
              <MemoryStick size={12} className="resource-usage-icon" />
              <span className="resource-usage-value">{vramUsedPct != null ? `${vramUsedPct}%` : "—"}</span>
              <span className="resource-usage-label">VRAM</span>
            </div>
            <ResourceBar percent={vramUsedPct ?? 0} height={3} />
          </div>
        </>
      )}
      <div className="resource-usage-block">
        <div className="resource-usage-row">
          <HardDrive size={12} className="resource-usage-icon" />
          <span className="resource-usage-value">{diskFreeGb}G</span>
          <span className="resource-usage-label">free</span>
        </div>
        <ResourceBar percent={diskUsedPct} height={3} />
      </div>
    </div>
  );
}
