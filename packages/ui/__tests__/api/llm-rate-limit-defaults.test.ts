import { describe, it, expect } from "vitest";
import { GET } from "../../app/api/llm/rate-limit-defaults/route";

describe("LLM rate-limit-defaults API", () => {
  it("GET /api/llm/rate-limit-defaults returns object", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toBeDefined();
    expect(typeof data === "object" && data !== null).toBe(true);
  });
});
