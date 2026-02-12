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
});
