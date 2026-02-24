import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const platform = os.platform();

/** When true, history is persisted to .data/system-stats-history.json so it survives restarts. False in Electron (resets on close). */
function shouldPersistHistory(): boolean {
  if (typeof process === "undefined" || !process.versions) return false;
  return !("electron" in process.versions);
}

function getDisk(): { total: number; free: number; path: string } {
  const checkPath = os.homedir();
  try {
    if (platform === "win32") {
      const drive = checkPath.slice(0, 2);
      // WMIC is deprecated and unavailable on Windows 10/11; use PowerShell Get-CimInstance
      // $ProgressPreference = 'SilentlyContinue' prevents "Preparing modules for first use" progress
      // from being serialized as CLIXML to stdout, which would pollute the captured output.
      try {
        const psScript = `$ProgressPreference = 'SilentlyContinue'; $d = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive}'"; if ($d) { "$($d.FreeSpace),$($d.Size)" }`;
        const encoded = Buffer.from(psScript, "utf16le").toString("base64");
        const output = execSync(
          `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
          {
            timeout: 5000,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          }
        )
          .trim()
          .split("\n")
          .map((s) => s.trim())
          .find((line) => /^\d+,\d+$/.test(line));
        if (output) {
          const [freeStr, totalStr] = output.split(",");
          const free = parseInt(freeStr!, 10);
          const total = parseInt(totalStr!, 10);
          if (!Number.isNaN(free) && !Number.isNaN(total)) {
            return { total, free, path: drive };
          }
        }
      } catch {
        // Fallback to WMIC for older Windows
      }
      const output = execSync(
        `wmic logicaldisk where "DeviceID='${drive}'" get Size,FreeSpace /format:csv`,
        { timeout: 3000, encoding: "utf8" }
      ).trim();
      const lines = output.split("\n").filter(Boolean);
      const lastLine = lines[lines.length - 1];
      const parts = lastLine.split(",");
      // CSV order: NodeName,DeviceID,FreeSpace,Size (alphabetical)
      const free = parseInt(parts[2] || "0", 10);
      const total = parseInt(parts[3] || "0", 10);
      return { total, free, path: drive };
    }
    const output = execSync(`df -k "${checkPath}" | tail -1`, {
      timeout: 3000,
      encoding: "utf8",
    }).trim();
    const parts = output.split(/\s+/);
    const total = parseInt(parts[1] || "0", 10) * 1024;
    const free = parseInt(parts[3] || "0", 10) * 1024;
    return { total, free, path: checkPath };
  } catch {
    return { total: 0, free: 0, path: checkPath };
  }
}

/**
 * Query nvidia-smi for utilization and VRAM. No caching: we try on every poll so that
 * when the user installs drivers and reopens the page or app, the next request will detect it.
 */
function getNvidiaLive(): {
  utilizationPercent: number;
  vramUsedBytes: number;
  vramTotalBytes: number;
}[] {
  const cmds =
    platform === "win32"
      ? ["nvidia-smi"]
      : ["nvidia-smi", "/usr/bin/nvidia-smi", "/usr/lib/nvidia/bin/nvidia-smi"];
  for (const cmd of cmds) {
    try {
      const output = execSync(
        `${cmd} --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits`,
        { timeout: 2000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
      ).trim();
      const lines = output.split("\n").filter((l) => l && !l.startsWith("utilization"));
      return lines.map((line) => {
        const parts = line.split(",").map((s) => s.trim());
        const util = parseInt(parts[0]?.replace("%", "") || "0", 10);
        const memUsedMiB = parseInt(parts[1]?.replace("MiB", "").trim() || "0", 10);
        const memTotalMiB = parseInt(parts[2]?.replace("MiB", "").trim() || "0", 10);
        return {
          utilizationPercent: isNaN(util) ? 0 : util,
          vramUsedBytes: memUsedMiB * 1024 * 1024,
          vramTotalBytes: memTotalMiB * 1024 * 1024,
        };
      });
    } catch {
      continue;
    }
  }
  return [];
}

export type SystemStatsSnapshot = {
  ts: number;
  ram: { total: number; free: number; used: number };
  process: { rss: number; heapUsed: number };
  cpu: { loadAvg: [number, number, number]; processUser: number; processSystem: number };
  disk: { total: number; free: number; path: string };
  gpu: { utilizationPercent: number; vramUsed: number; vramTotal: number }[];
};

export function collectSystemStats(): SystemStatsSnapshot {
  const mem = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  const loadAvg = os.loadavg();
  const ramTotal = os.totalmem();
  const ramFree = os.freemem();
  const disk = getDisk();
  const nvidia = getNvidiaLive();
  const gpu =
    nvidia.length > 0
      ? nvidia.map((g) => ({
          utilizationPercent: g.utilizationPercent,
          vramUsed: g.vramUsedBytes,
          vramTotal: g.vramTotalBytes,
        }))
      : [];

  return {
    ts: Date.now(),
    ram: { total: ramTotal, free: ramFree, used: ramTotal - ramFree },
    process: { rss: mem.rss, heapUsed: mem.heapUsed },
    cpu: {
      loadAvg: [loadAvg[0] ?? 0, loadAvg[1] ?? 0, loadAvg[2] ?? 0],
      processUser: cpuUsage.user,
      processSystem: cpuUsage.system,
    },
    disk: { total: disk.total, free: disk.free, path: disk.path },
    gpu,
  };
}

/** TTL for server-side cache so multiple tabs / rapid polls don't each run PowerShell + nvidia-smi. */
const STATS_CACHE_TTL_MS = 1200;

let statsCache: SystemStatsSnapshot | null = null;
let statsCacheTs = 0;

/** Returns current stats, reusing a recent snapshot if still valid. Use this from API route to avoid N-tab load. */
export function getCachedSystemStats(): SystemStatsSnapshot {
  const now = Date.now();
  if (statsCache != null && now - statsCacheTs < STATS_CACHE_TTL_MS) {
    return statsCache;
  }
  const snapshot = collectSystemStats();
  statsCache = snapshot;
  statsCacheTs = now;
  pushHistory(snapshot);
  return snapshot;
}

const MAX_HISTORY = 300; // 0.5s * 300 = 2.5 min
const history: SystemStatsSnapshot[] = [];

function getHistoryFilePath(): string {
  // Lazy to avoid circular dependency (db.ts defines getDataDir)
  const dataDir = process.env.AGENTRON_DATA_DIR ?? path.join(process.cwd(), ".data");
  return path.join(dataDir, "system-stats-history.json");
}
const HISTORY_FILE = getHistoryFilePath();
const FLUSH_INTERVAL_MS = 30_000; // persist at most every 30s
let lastFlushTs = 0;
let loadAttempted = false;

function loadHistoryFromDisk(): void {
  if (!shouldPersistHistory() || loadAttempted) return;
  loadAttempted = true;
  try {
    const dir = path.dirname(HISTORY_FILE);
    if (!fs.existsSync(dir)) return;
    if (!fs.existsSync(HISTORY_FILE)) return;
    const raw = fs.readFileSync(HISTORY_FILE, "utf8");
    const parsed = JSON.parse(raw) as SystemStatsSnapshot[];
    if (Array.isArray(parsed) && parsed.length > 0) {
      history.length = 0;
      history.push(...parsed.slice(-MAX_HISTORY));
    }
  } catch {
    // no file or invalid — keep in-memory only
  }
}

function flushHistoryToDisk(): void {
  if (!shouldPersistHistory() || history.length === 0) return;
  const now = Date.now();
  if (now - lastFlushTs < FLUSH_INTERVAL_MS) return;
  lastFlushTs = now;
  try {
    const dir = path.dirname(HISTORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history), "utf8");
  } catch {
    // ignore write errors
  }
}

let flushIntervalId: ReturnType<typeof setInterval> | undefined;
if (shouldPersistHistory() && typeof setInterval !== "undefined") {
  flushIntervalId = setInterval(flushHistoryToDisk, FLUSH_INTERVAL_MS);
  if (typeof process !== "undefined" && process.on) {
    process.on("beforeExit", () => {
      if (flushIntervalId != null) {
        clearInterval(flushIntervalId);
        flushIntervalId = undefined;
      }
    });
  }
}

export function pushHistory(snapshot: SystemStatsSnapshot): void {
  if (!loadAttempted) loadHistoryFromDisk();
  history.push(snapshot);
  if (history.length > MAX_HISTORY) history.shift();
  flushHistoryToDisk();
}

export function getHistory(): SystemStatsSnapshot[] {
  if (!loadAttempted) loadHistoryFromDisk();
  return [...history];
}
