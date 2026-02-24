import { describe, it, expect, vi } from "vitest";

vi.mock("node:os", () => ({ platform: () => "linux" }));

import { PATCH } from "../../app/api/settings/app/route";

describe("Settings app API (Unix platform)", () => {
  it("PATCH addShellCommand splits on semicolon when platform is Unix", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addShellCommand: "echo one ; echo two" }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.addedCommands)).toBe(true);
    expect(data.addedCommands).toContain("echo one");
    expect(data.addedCommands).toContain("echo two");
  });
});
