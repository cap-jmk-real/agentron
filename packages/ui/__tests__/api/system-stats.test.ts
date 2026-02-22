import { describe, it, expect, vi } from "vitest";
import { GET as statsGet } from "../../app/api/system-stats/route";
import { GET as historyGet } from "../../app/api/system-stats/history/route";
import {
  getCachedSystemStats,
  collectSystemStats,
  pushHistory,
  getHistory,
} from "../../app/api/_lib/system-stats";

describe("System stats API", () => {
  it("GET /api/system-stats returns snapshot with ram, process, cpu, disk, gpu", async () => {
    const res = await statsGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("ts");
    expect(data).toHaveProperty("ram");
    expect(data.ram).toHaveProperty("total");
    expect(data.ram).toHaveProperty("free");
    expect(data.ram).toHaveProperty("used");
    expect(data).toHaveProperty("process");
    expect(data.process).toHaveProperty("rss");
    expect(data.process).toHaveProperty("heapUsed");
    expect(data).toHaveProperty("cpu");
    expect(data.cpu).toHaveProperty("loadAvg");
    expect(data).toHaveProperty("disk");
    expect(data).toHaveProperty("gpu");
    expect(Array.isArray(data.gpu)).toBe(true);
  });

  it("GET /api/system-stats/history returns array", async () => {
    const res = await historyGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("getCachedSystemStats returns same snapshot within cache TTL", () => {
    vi.useFakeTimers();
    try {
      getCachedSystemStats(); // prime cache
      const a = getCachedSystemStats();
      const b = getCachedSystemStats();
      expect(a).toBe(b);
      expect(a.ts).toBe(b.ts);
      expect(a.ram.total).toBe(b.ram.total);
    } finally {
      vi.useRealTimers();
    }
  });

  it("collectSystemStats returns snapshot with required shape", () => {
    const snapshot = collectSystemStats();
    expect(snapshot.ts).toBeGreaterThan(0);
    expect(snapshot.ram).toEqual(
      expect.objectContaining({
        total: expect.any(Number),
        free: expect.any(Number),
        used: expect.any(Number),
      })
    );
    expect(snapshot.cpu.loadAvg).toHaveLength(3);
    expect(Array.isArray(snapshot.gpu)).toBe(true);
  });

  it("pushHistory and getHistory append and return history", () => {
    const before = getHistory().length;
    const snapshot = collectSystemStats();
    pushHistory(snapshot);
    const after = getHistory();
    expect(after.length).toBeGreaterThanOrEqual(before);
    expect(after[after.length - 1].ts).toBe(snapshot.ts);
  });
});
