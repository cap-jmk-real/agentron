import { describe, it, expect } from "vitest";
import { GET as listGet, POST as listPost } from "../../app/api/functions/route";

describe("Functions API", () => {
  it("GET /api/functions returns array", async () => {
    const res = await listGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("POST /api/functions creates function and tool", async () => {
    const res = await listPost(
      new Request("http://localhost/api/functions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Function",
          description: "A test",
          language: "javascript",
          source: "return 1 + 1;",
        }),
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.name).toBe("Test Function");
    expect(data.toolId).toBeDefined();
    expect(String(data.toolId).startsWith("fn-")).toBe(true);
  });
});
