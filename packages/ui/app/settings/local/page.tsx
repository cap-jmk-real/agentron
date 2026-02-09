"use client";

import { useEffect, useState, useCallback } from "react";

type OllamaModel = {
  name: string;
  size: number;
  digest: string;
  modifiedAt: string;
  parameterSize?: string;
  quantization?: string;
  family?: string;
};

type RunningModel = { name: string; size: number; sizeVram: number };

type GpuInfo = { available: boolean; name: string; vram: number; backend: string };
type SystemInfo = {
  ram: { total: number; free: number };
  disk: { total: number; free: number };
  gpu: GpuInfo[];
  platform: string;
};

type CompatResult = {
  canRun: boolean;
  canRunOnGpu: boolean;
  warnings: string[];
  recommendedGpuLayers: number;
};

const fmtBytes = (b: number) => {
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(0)} MB`;
  return `${b} bytes`;
};

const GPU_MODES = [
  { id: "auto", label: "Auto" },
  { id: "full", label: "Full GPU" },
  { id: "partial", label: "Partial GPU" },
  { id: "cpu", label: "CPU Only" },
];

export default function LocalModelsPage() {
  const [ollamaStatus, setOllamaStatus] = useState<{ running: boolean; version?: string } | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [running, setRunning] = useState<RunningModel[]>([]);
  const [loading, setLoading] = useState(true);

  // Pull state
  const [pullModel, setPullModel] = useState("");
  const [pullSize, setPullSize] = useState("7B");
  const [gpuMode, setGpuMode] = useState("auto");
  const [pulling, setPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState("");
  const [pullPct, setPullPct] = useState(0);
  const [compat, setCompat] = useState<CompatResult | null>(null);
  const [checkingCompat, setCheckingCompat] = useState(false);

  // Install flow
  const [installInfo, setInstallInfo] = useState<{ installUrl: string; platform: string; canBrewInstall: boolean } | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installLog, setInstallLog] = useState("");
  const [installDone, setInstallDone] = useState(false);

  // HF search
  const [hfQuery, setHfQuery] = useState("");
  const [hfResults, setHfResults] = useState<Array<{ id: string; downloads: number; hasGguf: boolean }>>([]);
  const [hfSearching, setHfSearching] = useState(false);

  const refresh = useCallback(async () => {
    const [statusRes, sysRes, modelsRes, installInfoRes] = await Promise.all([
      fetch("/api/ollama/status").then((r) => r.json()).catch(() => ({ running: false })),
      fetch("/api/ollama/system").then((r) => r.json()).catch(() => null),
      fetch("/api/ollama/models").then((r) => r.json()).catch(() => ({ models: [], running: [] })),
      fetch("/api/ollama/install-info").then((r) => r.json()).catch(() => null),
    ]);
    setOllamaStatus(statusRes);
    setSystem(sysRes);
    setModels(modelsRes.models ?? []);
    setRunning(modelsRes.running ?? []);
    setInstallInfo(installInfoRes);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const checkCompat = async () => {
    setCheckingCompat(true);
    try {
      const res = await fetch("/api/ollama/check-compatibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parameterSize: pullSize }),
      });
      setCompat(await res.json());
    } catch { setCompat(null); }
    setCheckingCompat(false);
  };

  const doPull = async () => {
    if (!pullModel.trim()) return;
    setPulling(true);
    setPullProgress("Starting...");
    setPullPct(0);

    try {
      const res = await fetch("/api/ollama/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: pullModel, parameterSize: pullSize }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({ error: "Unknown error" }));
        setPullProgress(`Error: ${data.error}`);
        setPulling(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.type === "compatibility") {
              setCompat(evt);
            } else if (evt.type === "progress") {
              const status = evt.status ?? "";
              if (evt.completed && evt.total) {
                const pct = Math.round((evt.completed / evt.total) * 100);
                setPullPct(pct);
                setPullProgress(`${status} ${pct}%`);
              } else {
                setPullProgress(status);
              }
            }
          } catch { /* skip */ }
        }
      }

      setPullProgress("Done!");
      setPullPct(100);
      await refresh();
    } catch {
      setPullProgress("Failed to connect to Ollama");
    }
    setPulling(false);
  };

  const deleteModel = async (name: string) => {
    await fetch(`/api/ollama/models/${encodeURIComponent(name)}`, { method: "DELETE" });
    setModels((prev) => prev.filter((m) => m.name !== name));
  };

  const searchHf = async () => {
    if (!hfQuery.trim()) return;
    setHfSearching(true);
    try {
      const res = await fetch(`/api/llm/models/search?q=${encodeURIComponent(hfQuery)}&source=huggingface`);
      const data = await res.json();
      setHfResults(Array.isArray(data) ? data : []);
    } catch { setHfResults([]); }
    setHfSearching(false);
  };

  const openDownload = () => {
    const url = installInfo?.installUrl ?? "https://ollama.com/download";
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const startBrewInstall = async () => {
    setInstalling(true);
    setInstallLog("");
    setInstallDone(false);
    try {
      const res = await fetch("/api/ollama/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "brew" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setInstallLog(data.error ?? `Request failed: ${res.status}`);
        setInstalling(false);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) {
        setInstallLog("No response body");
        setInstalling(false);
        return;
      }
      const decoder = new TextDecoder();
      let log = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        log += decoder.decode(value, { stream: true });
        setInstallLog(log);
      }
      setInstallDone(true);
      await refresh();
    } catch (e) {
      setInstallLog(e instanceof Error ? e.message : "Install failed");
    }
    setInstalling(false);
  };

  if (loading) return <div style={{ padding: "2rem", color: "var(--text-muted)" }}>Loading...</div>;

  const primaryGpu = system?.gpu?.find((g) => g.available) ?? system?.gpu?.[0];

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ margin: "0 0 0.25rem" }}>Local Models</h1>
      <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0 0 1.25rem" }}>
        Manage Ollama models running on your machine.
      </p>

      {/* System info banner */}
      {system && (
        <div className="card" style={{ padding: "0.65rem 0.85rem", marginBottom: "0.75rem", display: "flex", gap: "1.5rem", fontSize: "0.78rem" }}>
          <span><strong>RAM:</strong> {fmtBytes(system.ram.free)} free / {fmtBytes(system.ram.total)}</span>
          <span><strong>Disk:</strong> {fmtBytes(system.disk.free)} free</span>
          {primaryGpu && (
            <span>
              <strong>GPU:</strong> {primaryGpu.name}
              {primaryGpu.vram > 0 ? ` (${fmtBytes(primaryGpu.vram)} ${primaryGpu.backend.toUpperCase()})` : ""}
            </span>
          )}
        </div>
      )}

      {/* Ollama status */}
      <div className="card" style={{ padding: "0.85rem 1rem", marginBottom: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: ollamaStatus?.running ? "#22c55e" : "#dc2626" }} />
          <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>
            {ollamaStatus?.running ? `Ollama running (v${ollamaStatus.version ?? "?"})` : "Ollama not detected"}
          </span>
        </div>
        {!ollamaStatus?.running && (
          <div style={{ marginTop: "0.75rem" }}>
            <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0 0 0.6rem" }}>
              Install Ollama to run models locally. No terminal required.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
              <button
                type="button"
                className="button"
                onClick={openDownload}
                disabled={installing}
              >
                Install Ollama (download)
              </button>
              {installInfo?.canBrewInstall && (
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={startBrewInstall}
                  disabled={installing}
                >
                  {installing ? "Installing…" : "Install with Homebrew (macOS)"}
                </button>
              )}
            </div>
            {installing && installLog && (
              <pre style={{ marginTop: "0.75rem", padding: "0.6rem", borderRadius: 6, background: "var(--surface-muted)", fontSize: "0.72rem", overflow: "auto", maxHeight: 200, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {installLog}
              </pre>
            )}
            {installDone && <p style={{ marginTop: "0.5rem", fontSize: "0.8rem", color: "#16a34a", fontWeight: 500 }}>Install finished. Ollama should be starting.</p>}
            <details style={{ marginTop: "0.6rem", fontSize: "0.78rem", color: "var(--text-muted)" }}>
              <summary style={{ cursor: "pointer" }}>Or install via command line</summary>
              {system?.platform === "darwin" && <p style={{ margin: "0.35rem 0 0" }}><code>brew install ollama</code> then <code>ollama serve</code></p>}
              {system?.platform === "linux" && <p style={{ margin: "0.35rem 0 0" }}><code>curl -fsSL https://ollama.com/install.sh | sh</code> then <code>ollama serve</code></p>}
              {system?.platform === "win32" && <p style={{ margin: "0.35rem 0 0" }}>Download from <a href="https://ollama.com/download" target="_blank" rel="noreferrer" style={{ color: "var(--primary)" }}>ollama.com/download</a></p>}
            </details>
          </div>
        )}
      </div>

      {/* Installed models */}
      <h2 style={{ fontSize: "0.95rem", margin: "0 0 0.5rem" }}>Installed Models</h2>
      {models.length === 0 ? (
        <div className="card" style={{ padding: "1.5rem", textAlign: "center", marginBottom: "1rem" }}>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: 0 }}>No models installed</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "0.35rem", marginBottom: "1rem" }}>
          {models.map((m) => {
            const isRunning = running.some((r) => r.name === m.name);
            const runInfo = running.find((r) => r.name === m.name);
            return (
              <div key={m.name} className="card" style={{ padding: "0.55rem 0.75rem" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: "0.85rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                      {m.name}
                      {isRunning && <span style={{ fontSize: "0.65rem", padding: "0.1rem 0.35rem", borderRadius: 4, background: "rgba(34,197,94,0.12)", color: "#16a34a", fontWeight: 600 }}>Running</span>}
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", display: "flex", gap: "0.75rem", marginTop: "0.15rem" }}>
                      <span>{fmtBytes(m.size)}</span>
                      {m.parameterSize && <span>{m.parameterSize}</span>}
                      {m.quantization && <span>{m.quantization}</span>}
                      {m.family && <span>{m.family}</span>}
                      {runInfo && runInfo.sizeVram > 0 && <span>VRAM: {fmtBytes(runInfo.sizeVram)}</span>}
                    </div>
                  </div>
                  <button className="button button-ghost button-small" onClick={() => deleteModel(m.name)} style={{ color: "#dc2626" }}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pull model */}
      {ollamaStatus?.running && (
        <>
          <h2 style={{ fontSize: "0.95rem", margin: "0 0 0.5rem" }}>Pull Model</h2>
          <div className="card" style={{ padding: "0.85rem", marginBottom: "1rem" }}>
            <div className="form">
              <div className="field">
                <label>Model name</label>
                <input className="input" value={pullModel} onChange={(e) => setPullModel(e.target.value)} placeholder="e.g. llama3.1:8b, qwen2.5:7b" />
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <div className="field" style={{ flex: 1 }}>
                  <label>Parameter size (for compatibility check)</label>
                  <select className="select" value={pullSize} onChange={(e) => { setPullSize(e.target.value); setCompat(null); }}>
                    <option value="1B">1B</option>
                    <option value="3B">3B</option>
                    <option value="7B">7B</option>
                    <option value="8B">8B</option>
                    <option value="13B">13B</option>
                    <option value="14B">14B</option>
                    <option value="32B">32B</option>
                    <option value="70B">70B</option>
                    <option value="405B">405B</option>
                  </select>
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>GPU mode</label>
                  <select className="select" value={gpuMode} onChange={(e) => setGpuMode(e.target.value)}>
                    {GPU_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Compatibility check */}
              <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                <button className="button button-ghost button-small" onClick={checkCompat} disabled={checkingCompat}>
                  {checkingCompat ? "Checking..." : "Check Compatibility"}
                </button>
                {compat && (
                  <span style={{ fontSize: "0.78rem", fontWeight: 600, color: compat.canRun ? "#16a34a" : "#dc2626" }}>
                    {compat.canRun ? (compat.canRunOnGpu ? "Compatible (GPU)" : "Compatible (CPU)") : "Insufficient resources"}
                  </span>
                )}
              </div>

              {compat && compat.warnings.length > 0 && (
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "grid", gap: "0.15rem" }}>
                  {compat.warnings.map((w, i) => <span key={i}>&#x26A0; {w}</span>)}
                </div>
              )}

              {/* Pull progress */}
              {pulling && (
                <div>
                  <div style={{ width: "100%", height: 6, borderRadius: 3, background: "var(--border)", overflow: "hidden", marginBottom: "0.3rem" }}>
                    <div style={{ width: `${pullPct}%`, height: "100%", borderRadius: 3, background: "var(--primary)", transition: "width 200ms" }} />
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{pullProgress}</div>
                </div>
              )}

              <button className="button" onClick={doPull} disabled={pulling || !pullModel.trim()}>
                {pulling ? "Pulling..." : "Pull Model"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* HuggingFace search */}
      {ollamaStatus?.running && (
        <>
          <h2 style={{ fontSize: "0.95rem", margin: "0 0 0.5rem" }}>Import from HuggingFace</h2>
          <div className="card" style={{ padding: "0.85rem" }}>
            <div style={{ display: "flex", gap: "0.35rem", marginBottom: "0.6rem" }}>
              <input className="input" style={{ flex: 1 }} value={hfQuery} onChange={(e) => setHfQuery(e.target.value)} placeholder="Search HuggingFace models..." onKeyDown={(e) => e.key === "Enter" && searchHf()} />
              <button className="button button-small" onClick={searchHf} disabled={hfSearching}>
                {hfSearching ? "..." : "Search"}
              </button>
            </div>
            {hfResults.length > 0 && (
              <div style={{ display: "grid", gap: "0.25rem", maxHeight: 280, overflowY: "auto" }}>
                {hfResults.map((m) => (
                  <div key={m.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", fontSize: "0.78rem" }}>
                    <div>
                      <span style={{ fontWeight: 500 }}>{m.id}</span>
                      <span style={{ color: "var(--text-muted)", marginLeft: "0.5rem" }}>
                        {m.downloads.toLocaleString()} downloads
                        {m.hasGguf && <span style={{ marginLeft: "0.4rem", fontSize: "0.65rem", padding: "0.1rem 0.3rem", borderRadius: 3, background: "rgba(91,124,250,0.12)", color: "var(--primary)", fontWeight: 600 }}>GGUF</span>}
                      </span>
                    </div>
                    {m.hasGguf && (
                      <button
                        className="button button-small"
                        onClick={() => { setPullModel(`hf.co/${m.id}`); }}
                      >
                        Import
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
