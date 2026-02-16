import { describe, it, expect } from "vitest";
import { POST as executePost } from "../../app/api/functions/[id]/execute/route";
import { POST as fnPost } from "../../app/api/functions/route";

describe("Functions execute API", () => {
  it("POST /api/functions/:id/execute returns 404 for unknown function id", async () => {
    const res = await executePost(
      new Request("http://localhost/api/functions/non-existent-id/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: {} }),
      }),
      { params: Promise.resolve({ id: "non-existent-id" }) }
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain("Function not found");
  });

  it("POST /api/functions/:id/execute returns 400 when function has no sandbox", async () => {
    const createRes = await fnPost(
      new Request("http://localhost/api/functions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "NoSandboxFn",
          language: "javascript",
          source: "function main() { return 1; }",
        }),
      })
    );
    expect(createRes.status).toBe(201);
    const fn = await createRes.json();
    const res = await executePost(
      new Request(`http://localhost/api/functions/${fn.id}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: {} }),
      }),
      { params: Promise.resolve({ id: fn.id }) }
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/sandbox|No sandbox/i);
  });
});
