import { describe, it, expect } from "vitest";
import { GET } from "../../app/api/mcp/route";

describe("MCP API", () => {
  it("GET /api/mcp returns tools array", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("tools");
    expect(Array.isArray(data.tools)).toBe(true);
  });
});
