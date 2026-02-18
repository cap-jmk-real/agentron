import { describe, it, expect } from "vitest";
import { GET } from "../../app/api/feedback/for-scope/route";

describe("Feedback for-scope API", () => {
  it("GET /api/feedback/for-scope returns 400 when targetId missing", async () => {
    const res = await GET(new Request("http://localhost/api/feedback/for-scope"));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("targetId");
  });

  it("GET /api/feedback/for-scope returns 200 with items when targetId provided", async () => {
    const res = await GET(new Request("http://localhost/api/feedback/for-scope?targetId=agent-123"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("GET /api/feedback/for-scope accepts label and limit params", async () => {
    const res = await GET(new Request("http://localhost/api/feedback/for-scope?targetId=wf-1&label=good&limit=10"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });
});
