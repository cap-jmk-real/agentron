import { describe, it, expect } from "vitest";
import { GET } from "../../app/api/sandbox-shell/route";

describe("Sandbox shell API", () => {
  it("GET /api/sandbox-shell returns 426 Upgrade Required", async () => {
    const res = await GET();
    expect(res.status).toBe(426);
    expect(res.headers.get("Upgrade")).toBe("websocket");
    const text = await res.text();
    expect(text).toContain("WebSocket");
  });
});
