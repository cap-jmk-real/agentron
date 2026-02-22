import { describe, it, expect } from "vitest";
import { GET } from "../../app/api/setup/status/route";

describe("Setup status API", () => {
  it("GET /api/setup/status returns vaultExists and hasLlmProvider", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.vaultExists).toBe("boolean");
    expect(typeof data.hasLlmProvider).toBe("boolean");
  });
});
