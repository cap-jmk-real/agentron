import { describe, it, expect, afterEach, vi } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { getDataDir } from "../../../app/api/_lib/db";
import {
  wasRunAlreadyReported,
  markRunAsReported,
  getReportedRunsTTLMs,
} from "../../../app/api/_lib/github-reported-runs";

function getStorePath(): string {
  return path.join(getDataDir(), "github-reported-runs.json");
}

describe("github-reported-runs", () => {
  afterEach(() => {
    const p = getStorePath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
    vi.useRealTimers();
  });

  it("wasRunAlreadyReported returns false when never reported", () => {
    expect(wasRunAlreadyReported("run-1")).toBe(false);
  });

  it("markRunAsReported then wasRunAlreadyReported returns true", () => {
    markRunAsReported("run-1");
    expect(wasRunAlreadyReported("run-1")).toBe(true);
  });

  it("different run ids are independent", () => {
    markRunAsReported("run-1");
    expect(wasRunAlreadyReported("run-1")).toBe(true);
    expect(wasRunAlreadyReported("run-2")).toBe(false);
    markRunAsReported("run-2");
    expect(wasRunAlreadyReported("run-2")).toBe(true);
  });

  it("getReportedRunsTTLMs returns positive number", () => {
    expect(getReportedRunsTTLMs()).toBeGreaterThan(0);
  });

  it("entries older than TTL are pruned on load", () => {
    const ttl = getReportedRunsTTLMs();
    vi.useFakeTimers({ now: 1000 });
    markRunAsReported("run-old");
    vi.advanceTimersByTime(ttl + 1);
    expect(wasRunAlreadyReported("run-old")).toBe(false);
  });

  it("markRunAsReported does not duplicate same run id", () => {
    markRunAsReported("run-1");
    markRunAsReported("run-1");
    const p = getStorePath();
    const raw = fs.readFileSync(p, "utf-8");
    const data = JSON.parse(raw) as Array<{ runId: string }>;
    expect(data.filter((e) => e.runId === "run-1")).toHaveLength(1);
  });

  it("wasRunAlreadyReported returns false when store file has invalid JSON", () => {
    fs.writeFileSync(getStorePath(), "invalid json {", "utf-8");
    expect(wasRunAlreadyReported("run-1")).toBe(false);
  });

  it("wasRunAlreadyReported returns false when store file has non-array", () => {
    fs.writeFileSync(getStorePath(), "{}", "utf-8");
    expect(wasRunAlreadyReported("run-1")).toBe(false);
  });
});
