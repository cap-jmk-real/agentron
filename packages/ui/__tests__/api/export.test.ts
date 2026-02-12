import { describe, it, expect } from "vitest";
import { GET } from "../../app/api/export/route";

describe("Export API", () => {
  it("GET /api/export returns 400 for invalid type", async () => {
    const res = await GET(new Request("http://localhost/api/export?type=invalid"));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid type");
  });

  it("GET /api/export?type=all returns definition with version and schema", async () => {
    const res = await GET(new Request("http://localhost/api/export?type=all"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.version).toBeDefined();
    expect(data.exportedAt).toBeDefined();
    expect(data.schema).toBe("agentron-studio-definitions");
    expect(data).toHaveProperty("tools");
    expect(data).toHaveProperty("agents");
    expect(data).toHaveProperty("workflows");
  });

  it("GET /api/export?type=tools returns tools only", async () => {
    const res = await GET(new Request("http://localhost/api/export?type=tools"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("tools");
    expect(Array.isArray(data.tools)).toBe(true);
  });

  it("GET /api/export without type defaults to all", async () => {
    const res = await GET(new Request("http://localhost/api/export"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("agents");
    expect(data).toHaveProperty("workflows");
  });
});
