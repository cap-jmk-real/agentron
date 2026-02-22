import { describe, it, expect, vi } from "vitest";
import {
  rephraseAndClassify,
  shouldSkipRephrase,
  getSystemContext,
  buildRunResponseForChat,
  applyRephraseFixes,
  buildContinueShellApprovalMessage,
  generateConversationTitle,
  summarizeHistoryChunk,
} from "../../../../app/api/chat/_lib/run-turn-helpers";

describe("run-turn-helpers", () => {
  describe("rephraseAndClassify", () => {
    it("returns wantsRetry false and no rephrasedPrompt for empty or whitespace message", async () => {
      const manager = { chat: vi.fn() };
      expect(
        await rephraseAndClassify("", manager as never, { provider: "openai", model: "gpt-4" })
      ).toEqual({
        rephrasedPrompt: undefined,
        wantsRetry: false,
      });
      expect(
        await rephraseAndClassify("   ", manager as never, { provider: "openai", model: "gpt-4" })
      ).toEqual({
        rephrasedPrompt: undefined,
        wantsRetry: false,
      });
      expect(manager.chat).not.toHaveBeenCalled();
    });

    it("returns wantsRetry true without calling LLM for very short retry phrases", async () => {
      const manager = { chat: vi.fn() };
      const result = await rephraseAndClassify("retry", manager as never, {
        provider: "openai",
        model: "gpt-4",
      });
      expect(result).toEqual({ rephrasedPrompt: undefined, wantsRetry: true });
      expect(manager.chat).not.toHaveBeenCalled();
    });

    it("returns wantsRetry true for 'again' without calling LLM", async () => {
      const manager = { chat: vi.fn() };
      const result = await rephraseAndClassify("again", manager as never, {
        provider: "openai",
        model: "gpt-4",
      });
      expect(result.wantsRetry).toBe(true);
      expect(result.rephrasedPrompt).toBeUndefined();
      expect(manager.chat).not.toHaveBeenCalled();
    });

    it("returns wantsRetry true for 'try again' without calling LLM", async () => {
      const manager = { chat: vi.fn() };
      const result = await rephraseAndClassify("try again", manager as never, {
        provider: "openai",
        model: "gpt-4",
      });
      expect(result.wantsRetry).toBe(true);
      expect(manager.chat).not.toHaveBeenCalled();
    });

    it("does not treat long retry-like message as deterministic retry", async () => {
      const manager = {
        chat: vi.fn().mockResolvedValue({
          content:
            "<rephrased>Try again with different settings.</rephrased><wants_retry>no</wants_retry>",
          usage: {},
        }),
      };
      const result = await rephraseAndClassify(
        "try again with different settings",
        manager as never,
        {
          provider: "openai",
          model: "gpt-4",
        }
      );
      expect(manager.chat).toHaveBeenCalled();
      expect(result.wantsRetry).toBe(false);
    });

    it("calls LLM for non-retry short message", async () => {
      const manager = {
        chat: vi.fn().mockResolvedValue({
          content: "<rephrased>Yes, create an agent.</rephrased><wants_retry>no</wants_retry>",
          usage: {},
        }),
      };
      const result = await rephraseAndClassify("yes", manager as never, {
        provider: "openai",
        model: "gpt-4",
      });
      expect(manager.chat).toHaveBeenCalled();
      expect(result.rephrasedPrompt).toBe("Yes, create an agent.");
      expect(result.wantsRetry).toBe(false);
    });
  });

  describe("shouldSkipRephrase", () => {
    it("returns true for short non-question", () => {
      expect(shouldSkipRephrase("ok")).toBe(true);
      expect(shouldSkipRephrase("yes")).toBe(true);
    });

    it("returns false for question even if short", () => {
      expect(shouldSkipRephrase("What?")).toBe(false);
    });

    it("returns true when payload.skipRephrase is true", () => {
      expect(shouldSkipRephrase("anything", { skipRephrase: true })).toBe(true);
    });

    it("returns true for synthetic approved message", () => {
      expect(shouldSkipRephrase("The user approved and ran: something")).toBe(true);
    });

    it("returns true for allowlist message", () => {
      expect(shouldSkipRephrase("Added foo allowlist")).toBe(true);
    });
  });

  describe("getSystemContext", () => {
    it("returns string containing platform hint", () => {
      const ctx = getSystemContext();
      expect(typeof ctx).toBe("string");
      expect(ctx.length).toBeGreaterThan(0);
      expect(ctx).toMatch(/System:/);
    });
  });

  describe("buildRunResponseForChat", () => {
    it("includes run failed error and stack when present", () => {
      const run = {
        id: "run-1",
        status: "failed",
        output: {
          error: "Container not found",
          errorDetails: { message: "Not found", stack: "Error: Not found\n  at foo" },
        },
      };
      const text = buildRunResponseForChat(run, []);
      expect(text).toContain("**Run failed:** Container not found");
      expect(text).toContain("```");
      expect(text).toContain("Error: Not found");
      expect(text).toContain("[View full run](/runs/run-1)");
    });

    it("includes cancelled message when status cancelled", () => {
      const text = buildRunResponseForChat(
        { id: "r1", status: "cancelled", output: undefined },
        []
      );
      expect(text).toContain("Run was cancelled.");
    });

    it("includes agent output as string or JSON", () => {
      const text1 = buildRunResponseForChat(
        { id: "r1", status: "completed", output: { output: "Done" } },
        []
      );
      expect(text1).toContain("Done");
      const text2 = buildRunResponseForChat(
        { id: "r1", status: "completed", output: { output: { count: 1 } } },
        []
      );
      expect(text2).toContain("count");
    });

    it("includes waiting message when status waiting_for_user", () => {
      const text = buildRunResponseForChat(
        { id: "r1", status: "waiting_for_user", output: {} },
        []
      );
      expect(text).toContain("waiting for your input");
    });

    it("includes stderr lines matching error pattern", () => {
      const text = buildRunResponseForChat({ id: "r1", status: "completed", output: {} }, [
        { level: "stderr", message: "Error: something failed" },
        { level: "stdout", message: "ok" },
      ]);
      expect(text).toContain("Container/execution errors");
      expect(text).toContain("something failed");
    });

    it("uses errorDetails.message when output.error absent", () => {
      const text = buildRunResponseForChat(
        {
          id: "r1",
          status: "failed",
          output: {
            errorDetails: { message: "Only errorDetails message" },
          },
        },
        []
      );
      expect(text).toContain("**Run failed:** Only errorDetails message");
    });

    it("includes stack only when errorDetails has stack", () => {
      const text = buildRunResponseForChat(
        {
          id: "r1",
          status: "failed",
          output: {
            error: "Fail",
            errorDetails: { message: "No stack here" },
          },
        },
        []
      );
      expect(text).toContain("**Run failed:** Fail");
      expect(text).not.toContain("```");
    });

    it("treats output as null when output is array", () => {
      const text = buildRunResponseForChat({ id: "r1", status: "completed", output: ["item"] }, []);
      expect(text).toContain("[View full run](/runs/r1)");
      expect(text).not.toContain("item");
    });

    it("omits stderr section when no stderr matches error pattern", () => {
      const text = buildRunResponseForChat({ id: "r1", status: "completed", output: {} }, [
        { level: "stderr", message: "info: something" },
      ]);
      expect(text).not.toContain("Container/execution errors");
    });
  });

  describe("applyRephraseFixes", () => {
    it("fixes ThenI and linkedin casing", () => {
      expect(applyRephraseFixes("ThenI went to linkedin")).toBe("Then I went to LinkedIn");
      expect(applyRephraseFixes("sales navigator")).toBe("Sales Navigator");
    });
  });

  describe("buildContinueShellApprovalMessage", () => {
    it("includes command, exitCode, stdout and stderr when present", () => {
      const msg = buildContinueShellApprovalMessage({
        command: "ls -la",
        stdout: "out",
        stderr: "err",
        exitCode: 0,
      });
      expect(msg).toContain("ls -la");
      expect(msg).toContain("exitCode=0");
      expect(msg).toContain("stdout: out");
      expect(msg).toContain("stderr: err");
    });

    it("omits stdout/stderr when empty", () => {
      const msg = buildContinueShellApprovalMessage({
        command: "cmd",
        exitCode: 1,
      });
      expect(msg).toContain("exitCode=1");
      expect(msg).not.toMatch(/stdout:/);
      expect(msg).not.toMatch(/stderr:/);
    });

    it("truncates long stdout with ellipsis", () => {
      const long = "x".repeat(600);
      const msg = buildContinueShellApprovalMessage({
        command: "c",
        stdout: long,
      });
      expect(msg).toContain("…");
      expect(msg.length).toBeLessThan(700);
    });
  });

  describe("generateConversationTitle", () => {
    it("returns null for empty or whitespace message", async () => {
      const manager = { chat: vi.fn() };
      expect(
        await generateConversationTitle("", manager as never, { provider: "o", model: "m" })
      ).toBeNull();
      expect(
        await generateConversationTitle("   ", manager as never, { provider: "o", model: "m" })
      ).toBeNull();
      expect(manager.chat).not.toHaveBeenCalled();
    });

    it("returns fallback when chat throws", async () => {
      const manager = { chat: vi.fn().mockRejectedValue(new Error("LLM fail")) };
      const result = await generateConversationTitle("Hello world", manager as never, {
        provider: "o",
        model: "m",
      });
      expect(result).toBe("Hello world");
    });
  });

  describe("summarizeHistoryChunk", () => {
    it("returns empty string for empty messages", async () => {
      const manager = { chat: vi.fn() };
      const result = await summarizeHistoryChunk([], manager as never, {
        provider: "o",
        model: "m",
      });
      expect(result).toBe("");
      expect(manager.chat).not.toHaveBeenCalled();
    });
  });

  describe("rephraseAndClassify branches", () => {
    it("returns rephrasedPrompt undefined and wantsRetry false on LLM throw", async () => {
      const manager = { chat: vi.fn().mockRejectedValue(new Error("Network error")) };
      const result = await rephraseAndClassify("fix this", manager as never, {
        provider: "openai",
        model: "gpt-4",
      });
      expect(result).toEqual({ rephrasedPrompt: undefined, wantsRetry: false });
    });

    it("uses applyRephraseFixes when rephrased equals trimmed", async () => {
      const manager = {
        chat: vi.fn().mockResolvedValue({
          content: "<rephrased>theni linkedin</rephrased><wants_retry>no</wants_retry>",
          usage: {},
        }),
      };
      const result = await rephraseAndClassify("theni linkedin", manager as never, {
        provider: "openai",
        model: "gpt-4",
      });
      expect(result.rephrasedPrompt).toBe("Then I LinkedIn");
    });
  });
});
