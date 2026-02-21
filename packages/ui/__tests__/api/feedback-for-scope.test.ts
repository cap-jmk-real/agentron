import { describe, it, expect } from "vitest";
import { GET } from "../../app/api/feedback/for-scope/route";
import { POST as feedbackPost } from "../../app/api/feedback/route";

describe("Feedback for-scope API", () => {
  it("GET /api/feedback/for-scope returns 400 when targetId missing", async () => {
    const res = await GET(new Request("http://localhost/api/feedback/for-scope"));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("targetId");
  });

  it("GET /api/feedback/for-scope returns 200 with items when targetId provided", async () => {
    const res = await GET(
      new Request("http://localhost/api/feedback/for-scope?targetId=agent-123")
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("GET /api/feedback/for-scope accepts label and limit params", async () => {
    const res = await GET(
      new Request("http://localhost/api/feedback/for-scope?targetId=wf-1&label=good&limit=10")
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("GET /api/feedback/for-scope returns inputSummary and outputSummary with long text truncated", async () => {
    const targetId = "scope-summary-" + Date.now();
    await feedbackPost(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: "agent",
          targetId,
          input: "x".repeat(200),
          output: { nested: "value" },
          label: "good",
        }),
      })
    );
    const res = await GET(
      new Request(`http://localhost/api/feedback/for-scope?targetId=${targetId}`)
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
    const item = data.find((f: { targetId: string }) => f.targetId === targetId);
    expect(item).toBeDefined();
    expect(item.inputSummary).toBeDefined();
    expect(item.inputSummary!.length).toBeLessThanOrEqual(160);
    expect(item.inputSummary!.endsWith("…")).toBe(true);
    expect(item.outputSummary).toBeDefined();
  });
});
