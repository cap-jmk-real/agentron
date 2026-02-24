/** System stats polling interval: 0.5s to 5s. Stored in ms. Min 500ms to avoid flooding server (was 200ms). */
export const SYSTEM_STATS_INTERVAL_MIN_MS = 500;
export const SYSTEM_STATS_INTERVAL_MAX_MS = 5000;
export const SYSTEM_STATS_INTERVAL_DEFAULT_MS = 2000;

const STORAGE_KEY = "agentron-studio/system-stats-interval-ms";
export const SYSTEM_STATS_INTERVAL_CHANGED_EVENT = "system-stats-interval-changed";

function clamp(ms: number): number {
  return Math.max(
    SYSTEM_STATS_INTERVAL_MIN_MS,
    Math.min(SYSTEM_STATS_INTERVAL_MAX_MS, Math.round(ms))
  );
}

/** Read interval from localStorage (clamped). Uses default if missing or invalid. */
export function getSystemStatsIntervalMs(): number {
  if (typeof window === "undefined") return SYSTEM_STATS_INTERVAL_DEFAULT_MS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return SYSTEM_STATS_INTERVAL_DEFAULT_MS;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return SYSTEM_STATS_INTERVAL_DEFAULT_MS;
    return clamp(n);
  } catch {
    return SYSTEM_STATS_INTERVAL_DEFAULT_MS;
  }
}

/** Write interval (in ms), clamp to allowed range, and notify listeners. */
export function setSystemStatsIntervalMs(ms: number): void {
  const value = clamp(ms);
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
    window.dispatchEvent(new CustomEvent(SYSTEM_STATS_INTERVAL_CHANGED_EVENT, { detail: value }));
  } catch {
    // ignore
  }
}

/** Step for slider (ms). */
export const SYSTEM_STATS_INTERVAL_STEP_MS = 10;

/** Format interval for display (e.g. "0.4 s" or "0.01 s"). */
export function formatSystemStatsInterval(ms: number): string {
  const sec = ms / 1000;
  return sec >= 1 ? `${sec.toFixed(1)} s` : `${sec.toFixed(2)} s`;
}
