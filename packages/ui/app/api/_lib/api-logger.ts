import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const LOG_FILE = "agentron-api.log";

/** Normalize so Windows gets a valid path (no mixed slashes). */
function normalizeDir(dir: string): string {
  return path.normalize(dir);
}

function getLogDir(): string {
  const raw = process.env.AGENTRON_DATA_DIR ?? path.join(process.cwd(), ".data");
  const dir = normalizeDir(raw);
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {
    return "";
  }
  return dir;
}

function getLogPath(): string {
  const dir = getLogDir();
  return dir ? path.join(dir, LOG_FILE) : "";
}

/** Fallback log path when data dir is not writable (e.g. permissions). */
function getFallbackLogPath(): string {
  try {
    const tmp = os.tmpdir();
    return path.join(tmp, "agentron-api.log");
  } catch {
    return "";
  }
}

function writeLogLine(toWrite: string): void {
  const primary = getLogPath();
  if (primary) {
    try {
      fs.appendFileSync(primary, toWrite, "utf8");
      return;
    } catch {
      // fall through to fallback
    }
  }
  const fallback = getFallbackLogPath();
  if (fallback) {
    try {
      fs.appendFileSync(fallback, toWrite, "utf8");
    } catch {
      // ignore
    }
  }
}

/**
 * Append a single line to the API log (for request tracing). Safe to call from any API route.
 */
export function appendLogLine(route: string, method: string, message: string): void {
  const line = `${new Date().toISOString()} | ${method} | ${route} | ${message}\n`;
  writeLogLine(line);
}

/**
 * Append an API error to the log file (data dir). Safe to call from any API route.
 * Falls back to os.tmpdir() if the data dir is not writable.
 */
export function logApiError(route: string, method: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  const line = [
    new Date().toISOString(),
    method,
    route,
    msg,
    stack ? `\n${stack}` : "",
  ].join(" | ");
  const toWrite = line + "\n";
  writeLogLine(toWrite);
}

/**
 * Read the last N lines of the API log for the debug info bundle.
 * Checks primary (data dir) then fallback (tmp) so "Copy debug info" shows logs from either.
 */
export function getLogExcerpt(maxLines: number = 100): string {
  const paths = [getLogPath(), getFallbackLogPath()].filter(Boolean);
  const parts: string[] = [];
  for (const logPath of paths) {
    if (!logPath || !fs.existsSync(logPath)) continue;
    try {
      const content = fs.readFileSync(logPath, "utf8");
      const lines = content.split("\n").filter(Boolean);
      if (lines.length === 0) continue;
      const excerpt = lines.slice(-maxLines);
      const isFallback = logPath.startsWith(os.tmpdir());
      const label = isFallback ? "(fallback tmp)" : "";
      if (label) parts.push(`--- ${label} ${logPath} ---`);
      parts.push(excerpt.join("\n"));
    } catch {
      // ignore
    }
  }
  return parts.join("\n\n");
}

/**
 * Try to write one line to the log file so we can verify it's writable (e.g. in desktop app).
 * Call from GET /api/debug/info so "Copy debug info" shows the probe line if the file works.
 */
export function probeLogWritable(): boolean {
  const logPath = getLogPath();
  if (!logPath) return false;
  try {
    const line = `${new Date().toISOString()} | PROBE | /api/debug/info | Log file is writable\n`;
    fs.appendFileSync(logPath, line, "utf8");
    return true;
  } catch {
    const fallback = getFallbackLogPath();
    if (!fallback) return false;
    try {
      fs.appendFileSync(fallback, `${new Date().toISOString()} | PROBE | (fallback) Log file writable\n`, "utf8");
      return true;
    } catch {
      return false;
    }
  }
}

export { getLogDir, getLogPath };
