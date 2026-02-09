import { describe, it, expect } from "vitest";
import { GET } from "../../app/api/rate-limit/queue/route";

describe("Rate limit queue API", () => {
  it("GET /api/rate-limit/queue returns pending and recentDelayed", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("pending");
    expect(data).toHaveProperty("recentDelayed");
    expect(Array.isArray(data.pending)).toBe(true);
    expect(Array.isArray(data.recentDelayed)).toBe(true);
  });
});
