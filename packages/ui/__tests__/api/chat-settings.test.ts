import { describe, it, expect } from "vitest";
import { GET, PATCH } from "../../app/api/chat/settings/route";

describe("Chat settings API", () => {
  it("GET /api/chat/settings returns default or saved settings", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe("default");
    expect(data).toHaveProperty("customSystemPrompt");
    expect(data).toHaveProperty("temperature");
    expect(data).toHaveProperty("historyCompressAfter");
    expect(data).toHaveProperty("historyKeepRecent");
    expect(data).toHaveProperty("plannerRecentMessages");
    expect(typeof data.plannerRecentMessages === "number" || data.plannerRecentMessages === null).toBe(true);
  });

  it("PATCH /api/chat/settings updates settings", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/chat/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customSystemPrompt: "You are helpful.", temperature: 0.5 }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.customSystemPrompt).toBe("You are helpful.");
    expect(data.temperature).toBe(0.5);
  });

  it("PATCH /api/chat/settings accepts context ids and numeric options", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/chat/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contextAgentIds: ["a1", "a2"],
          contextWorkflowIds: ["w1"],
          contextToolIds: [],
          recentSummariesCount: 5,
          historyCompressAfter: 50,
          historyKeepRecent: 20,
          plannerRecentMessages: 15,
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.recentSummariesCount).toBe(5);
    expect(data.historyCompressAfter).toBe(50);
    expect(data.historyKeepRecent).toBe(20);
    expect(data.plannerRecentMessages).toBe(15);
  });

  it("PATCH /api/chat/settings with invalid JSON returns 200 with existing state", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/chat/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("id", "default");
  });
});
