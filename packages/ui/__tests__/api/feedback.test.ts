import { describe, it, expect } from "vitest";
import { GET as listGet, POST as listPost } from "../../app/api/feedback/route";
import { DELETE as deleteOne } from "../../app/api/feedback/[id]/route";

describe("Feedback API", () => {
  let createdId: string;

  it("GET /api/feedback returns array", async () => {
    const res = await listGet(new Request("http://localhost/api/feedback"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("POST /api/feedback creates entry", async () => {
    const res = await listPost(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: "agent",
          targetId: "agent-1",
          input: "test input",
          output: "test output",
          label: "good",
        }),
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.targetType).toBe("agent");
    createdId = data.id;
  });

  it("GET /api/feedback?targetType=agent returns filtered list", async () => {
    const res = await listGet(new Request("http://localhost/api/feedback?targetType=agent"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.every((f: { targetType: string }) => f.targetType === "agent")).toBe(true);
  });

  it("GET /api/feedback?targetId=agent-1 returns filtered list", async () => {
    const res = await listGet(new Request("http://localhost/api/feedback?targetId=agent-1"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("GET /api/feedback?executionId=some-id returns filtered list", async () => {
    const res = await listGet(new Request("http://localhost/api/feedback?executionId=exec-123"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("DELETE /api/feedback/:id removes entry", async () => {
    const res = await deleteOne(new Request("http://localhost/api/feedback/x", { method: "DELETE" }), {
      params: Promise.resolve({ id: createdId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });
});
