/**
 * Tests runShellCommand when spawn emits "error" (covers exitCode -1 path).
 * Isolated in its own file so we can vi.mock("node:child_process") before importing shell-exec.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawn: () => {
    const proc = {
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (ev: string, cb: () => void) => {
        if (ev === "error") setImmediate(cb);
      },
    };
    return proc;
  },
}));

import { runShellCommand } from "../../../app/api/_lib/shell-exec";

describe("shell-exec spawn error", () => {
  it("runShellCommand resolves with exitCode -1 when spawn emits error", async () => {
    const out = await runShellCommand("any");
    expect(out.exitCode).toBe(-1);
    expect(out.stdout).toBe("");
    expect(out.stderr).toBe("");
  });
});
