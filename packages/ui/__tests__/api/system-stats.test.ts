import { describe, it, expect } from "vitest";
import { GET as statsGet } from "../../app/api/system-stats/route";
import { GET as historyGet } from "../../app/api/system-stats/history/route";

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
});
