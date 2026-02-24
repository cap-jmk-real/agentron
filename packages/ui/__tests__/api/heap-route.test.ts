import { describe, it, expect } from "vitest";
import { GET } from "../../app/api/heap/route";

describe("GET /api/heap", () => {
  it("returns heap snapshot with topLevelIds, specialists, overlayIds", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("topLevelIds");
    expect(data).toHaveProperty("specialists");
    expect(data).toHaveProperty("overlayIds");
    expect(Array.isArray(data.topLevelIds)).toBe(true);
    expect(Array.isArray(data.specialists)).toBe(true);
    expect(Array.isArray(data.overlayIds)).toBe(true);
    for (const s of data.specialists) {
      expect(s).toHaveProperty("id");
      expect(typeof s.id).toBe("string");
      expect(s).toHaveProperty("toolNames");
      expect(Array.isArray(s.toolNames)).toBe(true);
    }
  });
});
