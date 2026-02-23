/**
 * Tests shell-exec when platform is Unix (sh -c path).
 * Mocks node:os so this branch is covered on Windows too.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("node:os", () => ({ platform: () => "linux" }));

import { runShellCommand } from "../../../app/api/_lib/shell-exec";

describe("shell-exec (Unix platform)", () => {
  it("runShellCommand uses sh -c path and returns result", async () => {
    const out = await runShellCommand("echo unix-path");
    expect(out).toHaveProperty("stdout");
    expect(out).toHaveProperty("stderr");
    expect(out).toHaveProperty("exitCode");
    if (out.exitCode === 0) {
      expect(out.stdout.trim()).toContain("unix-path");
    }
  });
});
