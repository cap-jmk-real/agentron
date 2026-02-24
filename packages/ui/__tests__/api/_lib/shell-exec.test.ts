import { describe, it, expect, vi } from "vitest";
import { platform } from "node:os";
import { spawn } from "node:child_process";
import { splitShellCommands, runShellCommand } from "../../../app/api/_lib/shell-exec";

vi.mock("node:child_process", async (importOriginal) => {
  const mod = await importOriginal<typeof import("node:child_process")>();
  return { ...mod, spawn: vi.fn(mod.spawn) };
});

describe("shell-exec", () => {
  describe("splitShellCommands", () => {
    it("splits on && and returns non-empty parts", () => {
      const result = splitShellCommands("echo one && echo two");
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result.some((c) => c.includes("echo one"))).toBe(true);
      expect(result.some((c) => c.includes("echo two"))).toBe(true);
    });

    it("splits on ||", () => {
      const result = splitShellCommands("false || echo fallback");
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it("does not split separator inside double quotes", () => {
      const result = splitShellCommands('echo "a && b"');
      expect(result.some((c) => c.includes("a && b"))).toBe(true);
    });

    it("does not split separator inside single quotes", () => {
      const result = splitShellCommands("echo 'a && b'");
      expect(result.some((c) => c.includes("a") && c.includes("b"))).toBe(true);
    });

    it("returns single command when no separator", () => {
      const result = splitShellCommands("single command");
      expect(result).toEqual(["single command"]);
    });

    it("trims parts and skips empty", () => {
      const result = splitShellCommands("  a  &&  b  ");
      expect(result.every((c) => c === c.trim())).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it("splits on semicolon on Unix", () => {
      const result = splitShellCommands("cmd1; cmd2");
      if (platform() === "win32") {
        expect(result).toHaveLength(1);
        expect(result[0]).toContain(";");
      } else {
        expect(result).toHaveLength(2);
        expect(result[0].trim()).toBe("cmd1");
        expect(result[1].trim()).toBe("cmd2");
      }
    });

    it("splits on single ampersand on Windows", () => {
      const result = splitShellCommands("cmd1 & cmd2");
      if (platform() === "win32") {
        expect(result.length).toBeGreaterThanOrEqual(2);
      } else {
        expect(result).toHaveLength(1);
        expect(result[0]).toContain("&");
      }
    });
  });

  describe("runShellCommand", () => {
    it("runs simple command and returns stdout, stderr, exitCode", async () => {
      const out = await runShellCommand("echo hello");
      expect(out).toHaveProperty("stdout");
      expect(out).toHaveProperty("stderr");
      expect(out).toHaveProperty("exitCode");
      expect(typeof out.stdout).toBe("string");
      expect(typeof out.stderr).toBe("string");
      expect(typeof out.exitCode).toBe("number");
      expect(out.stdout.trim()).toContain("hello");
      expect(out.exitCode).toBe(0);
    }, 20000);

    it("returns exitCode 0 for successful command", async () => {
      const out = await runShellCommand("echo 0");
      expect(out.exitCode).toBe(0);
      expect(out.stdout.trim()).toContain("0");
    }, 20000);

    it("uses sh -c on non-Windows (Unix path)", async () => {
      if (platform() === "win32") return;
      const out = await runShellCommand("echo unix");
      expect(out.exitCode).toBe(0);
      expect(out.stdout.trim()).toContain("unix");
    });

    it("returns non-zero exitCode when command fails or fails to spawn", async () => {
      const out = await runShellCommand("nonexistent-executable-name-12345");
      expect(out.exitCode).not.toBe(0);
      expect(typeof out.stdout).toBe("string");
      expect(typeof out.stderr).toBe("string");
    }, 20000);

    it.skipIf(process.platform !== "win32")(
      "splitShellCommands uses Windows separators when platform is win32",
      () => {
        const os = require("node:os");
        const platformSpy = vi.spyOn(os, "platform").mockReturnValue("win32");
        try {
          const result = splitShellCommands("cmd1 & cmd2");
          expect(result.length).toBeGreaterThanOrEqual(2);
        } finally {
          platformSpy.mockRestore();
        }
      }
    );

    it("runShellCommand resolves with exitCode -1 when spawn emits error", async () => {
      vi.mocked(spawn).mockImplementation(
        () =>
          ({
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            on(ev: string, cb: () => void) {
              if (ev === "error") setImmediate(cb);
            },
          }) as unknown as ReturnType<typeof spawn>
      );
      try {
        const out = await runShellCommand("echo x");
        expect(out.exitCode).toBe(-1);
        expect(out.stdout).toBe("");
        expect(out.stderr).toBe("");
      } finally {
        vi.mocked(spawn).mockRestore();
      }
    });
  });
});
