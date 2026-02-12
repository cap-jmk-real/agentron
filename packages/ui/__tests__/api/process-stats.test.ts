import { describe, it, expect } from "vitest";
import { GET } from "../../app/api/process-stats/route";

describe("Process stats API", () => {
  it("GET /api/process-stats returns memory and cpu", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("memory");
    expect(data.memory).toHaveProperty("rss");
    expect(data.memory).toHaveProperty("heapTotal");
    expect(data.memory).toHaveProperty("heapUsed");
    expect(data).toHaveProperty("cpu");
    expect(data.cpu).toHaveProperty("user");
    expect(data.cpu).toHaveProperty("system");
  });
});
