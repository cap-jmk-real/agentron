/**
 * Store of run ids that have already been reported to GitHub (with TTL).
 * Prevents duplicate issues when multiple code paths fire for the same failed run.
 */

import path from "node:path";
import fs from "node:fs";
import { getDataDir } from "./db";

const FILENAME = "github-reported-runs.json";
const TTL_MS = 10 * 60 * 1000; // 10 minutes

type Entry = { runId: string; reportedAt: number };

function getStorePath(): string {
  return path.join(getDataDir(), FILENAME);
}

function load(): Entry[] {
  const p = getStorePath();
  if (!fs.existsSync(p)) return [];
  try {
    const raw = fs.readFileSync(p, "utf-8");
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    const now = Date.now();
    return (data as Entry[]).filter(
      (e) =>
        e &&
        typeof e === "object" &&
        typeof e.runId === "string" &&
        typeof e.reportedAt === "number" &&
        now - e.reportedAt < TTL_MS
    );
  } catch {
    return [];
  }
}

function save(entries: Entry[]): void {
  const p = getStorePath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(entries, null, 2), "utf-8");
}

/**
 * Returns true if this run id was already reported within the TTL window.
 */
export function wasRunAlreadyReported(runId: string): boolean {
  const entries = load();
  return entries.some((e) => e.runId === runId);
}

/**
 * Marks the run id as reported. Call after successfully creating the GitHub issue.
 * Prunes entries older than TTL before adding.
 */
export function markRunAsReported(runId: string): void {
  const entries = load();
  const now = Date.now();
  const pruned = entries.filter((e) => now - e.reportedAt < TTL_MS);
  if (pruned.some((e) => e.runId === runId)) return;
  pruned.push({ runId, reportedAt: now });
  save(pruned);
}

/**
 * TTL in ms (for tests).
 */
export function getReportedRunsTTLMs(): number {
  return TTL_MS;
}
