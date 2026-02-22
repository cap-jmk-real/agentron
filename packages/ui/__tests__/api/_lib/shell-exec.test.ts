import { describe, it, expect } from "vitest";
import { platform } from "node:os";
import { splitShellCommands, runShellCommand } from "../../../app/api/_lib/shell-exec";

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
    });

    it("returns exitCode 0 for successful command", async () => {
      const out = await runShellCommand("echo 0");
      expect(out.exitCode).toBe(0);
      expect(out.stdout.trim()).toContain("0");
    });

    it("returns non-zero exitCode when command fails or fails to spawn", async () => {
      const out = await runShellCommand("nonexistent-executable-name-12345");
      expect(out.exitCode).not.toBe(0);
      expect(typeof out.stdout).toBe("string");
      expect(typeof out.stderr).toBe("string");
    });
  });
});
