import { describe, it, expect, vi } from "vitest";
import {
  rephraseAndClassify,
  shouldSkipRephrase,
  getSystemContext,
  buildRunResponseForChat,
  applyRephraseFixes,
  buildContinueShellApprovalMessage,
  generateConversationTitle,
  summarizeConversation,
  summarizeHistoryChunk,
} from "../../../../app/api/chat/_lib/run-turn-helpers";
import { db, conversations, chatMessages } from "../../../../app/api/_lib/db";
import { eq } from "drizzle-orm";

vi.mock("node:os", () => ({
  platform: vi.fn(() => "linux"),
}));

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

    it("returns Windows hint when platform is win32", async () => {
      const os = await import("node:os");
      vi.mocked(os.platform).mockReturnValueOnce("win32");
      const ctx = getSystemContext();
      expect(ctx).toMatch(/Windows|PowerShell|backslash/i);
    });

    it("returns macOS hint when platform is darwin", async () => {
      const os = await import("node:os");
      vi.mocked(os.platform).mockReturnValueOnce("darwin");
      const ctx = getSystemContext();
      expect(ctx).toMatch(/macOS|Unix|which|ls/i);
    });

    it("returns Linux hint when platform is linux", async () => {
      const os = await import("node:os");
      vi.mocked(os.platform).mockReturnValueOnce("linux");
      const ctx = getSystemContext();
      expect(ctx).toMatch(/Linux|Unix|which|ls/i);
    });

    it("returns generic hint for other platforms", async () => {
      const os = await import("node:os");
      vi.mocked(os.platform).mockReturnValueOnce("freebsd");
      const ctx = getSystemContext();
      expect(ctx).toMatch(/freebsd|System:/);
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

    it("omits run error and agent output when output is not object (e.g. string)", () => {
      const text = buildRunResponseForChat(
        {
          id: "r1",
          status: "completed",
          output: "raw string output" as unknown as Record<string, unknown>,
        },
        []
      );
      expect(text).not.toContain("**Run failed:**");
      expect(text).not.toContain("raw string output");
      expect(text).toContain("[View full run](/runs/r1)");
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

    it("uses empty string for exitCode when undefined", () => {
      const msg = buildContinueShellApprovalMessage({
        command: "echo ok",
        stdout: "",
        stderr: "",
      });
      expect(msg).toContain("exitCode=");
      expect(msg).not.toContain("stdout:");
      expect(msg).not.toContain("stderr:");
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

    it("truncates long stderr with ellipsis", () => {
      const long = "e".repeat(600);
      const msg = buildContinueShellApprovalMessage({
        command: "c",
        stderr: long,
      });
      expect(msg).toContain("…");
      expect(msg).toContain("stderr:");
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

    it("returns fallback with ellipsis when message exceeds TITLE_FALLBACK_MAX_LEN", async () => {
      const manager = { chat: vi.fn().mockRejectedValue(new Error("LLM fail")) };
      const longMessage = "This is a very long first message that exceeds forty characters here";
      const result = await generateConversationTitle(longMessage, manager as never, {
        provider: "o",
        model: "m",
      });
      expect(result).toContain("…");
      expect(result).toBe(longMessage.slice(0, 40).trim() + "…");
    });

    it("returns title from response when chat returns content", async () => {
      const manager = {
        chat: vi.fn().mockResolvedValue({ content: "  User asked about workflows  ", usage: {} }),
      };
      const result = await generateConversationTitle("Create a workflow", manager as never, {
        provider: "o",
        model: "m",
      });
      expect(result).toBe("User asked about workflows");
    });

    it("returns fallback when chat returns empty or whitespace content", async () => {
      const manager = {
        chat: vi.fn().mockResolvedValue({ content: "", usage: {} }),
      };
      const result = await generateConversationTitle("Hello world", manager as never, {
        provider: "o",
        model: "m",
      });
      expect(result).toBe("Hello world");
    });
  });

  describe("summarizeConversation", () => {
    it("returns without error when conversation has no messages (early return)", async () => {
      const convId = "sumconv-empty-" + Date.now();
      await db
        .insert(conversations)
        .values({ id: convId, title: null, createdAt: Date.now() })
        .run();
      const manager = { chat: vi.fn() };
      await summarizeConversation(convId, manager as never, { provider: "p", model: "m" });
      expect(manager.chat).not.toHaveBeenCalled();
      await db.delete(conversations).where(eq(conversations.id, convId)).run();
    });

    it("updates conversation summary when messages exist and manager returns content", async () => {
      const convId = "sumconv-ok-" + Date.now();
      await db
        .insert(conversations)
        .values({ id: convId, title: null, createdAt: Date.now() })
        .run();
      await db
        .insert(chatMessages)
        .values([
          {
            id: "m1",
            conversationId: convId,
            role: "user",
            content: "How do I create a workflow?",
            createdAt: Date.now(),
          },
          {
            id: "m2",
            conversationId: convId,
            role: "assistant",
            content: "You can create one from the workflows page.",
            createdAt: Date.now(),
          },
        ])
        .run();
      const manager = {
        chat: vi.fn().mockResolvedValue({
          content: "User asked about creating workflows. Assistant explained the workflows page.",
          usage: {},
        }),
      };
      await summarizeConversation(convId, manager as never, { provider: "p", model: "m" });
      const rows = await db.select().from(conversations).where(eq(conversations.id, convId));
      expect(rows[0].summary).toBe(
        "User asked about creating workflows. Assistant explained the workflows page."
      );
      await db.delete(chatMessages).where(eq(chatMessages.conversationId, convId)).run();
      await db.delete(conversations).where(eq(conversations.id, convId)).run();
    });

    it("ignores errors (catch branch)", async () => {
      const convId = "sumconv-err-" + Date.now();
      await db
        .insert(conversations)
        .values({ id: convId, title: null, createdAt: Date.now() })
        .run();
      await db
        .insert(chatMessages)
        .values({
          id: "m1",
          conversationId: convId,
          role: "user",
          content: "Hi",
          createdAt: Date.now(),
        })
        .run();
      const manager = { chat: vi.fn().mockRejectedValue(new Error("LLM down")) };
      await expect(
        summarizeConversation(convId, manager as never, { provider: "p", model: "m" })
      ).resolves.toBeUndefined();
      await db.delete(chatMessages).where(eq(chatMessages.conversationId, convId)).run();
      await db.delete(conversations).where(eq(conversations.id, convId)).run();
    });

    it("does not update summary when manager returns empty or whitespace content", async () => {
      const convId = "sumconv-nosum-" + Date.now();
      await db
        .insert(conversations)
        .values({ id: convId, title: null, summary: null, createdAt: Date.now() })
        .run();
      await db
        .insert(chatMessages)
        .values({
          id: "m1",
          conversationId: convId,
          role: "user",
          content: "Hi",
          createdAt: Date.now(),
        })
        .run();
      const manager = {
        chat: vi.fn().mockResolvedValue({ content: "   ", usage: {} }),
      };
      await summarizeConversation(convId, manager as never, { provider: "p", model: "m" });
      const rows = await db.select().from(conversations).where(eq(conversations.id, convId));
      expect(rows[0].summary).toBeNull();
      await db.delete(chatMessages).where(eq(chatMessages.conversationId, convId)).run();
      await db.delete(conversations).where(eq(conversations.id, convId)).run();
    });

    it("truncates message content with ellipsis when length > 300", async () => {
      const convId = "sumconv-long-" + Date.now();
      const longContent = "a".repeat(400);
      await db
        .insert(conversations)
        .values({ id: convId, title: null, createdAt: Date.now() })
        .run();
      await db
        .insert(chatMessages)
        .values({
          id: "m1",
          conversationId: convId,
          role: "user",
          content: longContent,
          createdAt: Date.now(),
        })
        .run();
      const manager = {
        chat: vi.fn().mockResolvedValue({
          content: "User sent a long message.",
          usage: {},
        }),
      };
      await summarizeConversation(convId, manager as never, { provider: "p", model: "m" });
      const userMsg = vi
        .mocked(manager.chat)
        .mock.calls[0][1].messages?.find((m: { role: string }) => m.role === "user");
      expect(userMsg?.content).toContain("a".repeat(300));
      expect(userMsg?.content).toContain("…");
      await db.delete(chatMessages).where(eq(chatMessages.conversationId, convId)).run();
      await db.delete(conversations).where(eq(conversations.id, convId)).run();
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

    it("returns fallback when chat returns empty content", async () => {
      const manager = {
        chat: vi.fn().mockResolvedValue({ content: "   ", usage: {} }),
      };
      const result = await summarizeHistoryChunk(
        [
          { role: "user", content: "Hi" },
          { role: "assistant", content: "Hello" },
        ],
        manager as never,
        { provider: "o", model: "m" }
      );
      expect(result).toBe("Earlier messages in this conversation.");
    });

    it("returns summary when chat returns content", async () => {
      const manager = {
        chat: vi.fn().mockResolvedValue({
          content: "User said hi. Assistant greeted back.",
          usage: {},
        }),
      };
      const result = await summarizeHistoryChunk(
        [{ role: "user", content: "Hi" }],
        manager as never,
        { provider: "o", model: "m" }
      );
      expect(result).toBe("User said hi. Assistant greeted back.");
    });

    it("truncates long message content with ellipsis in prompt (content.length > 400)", async () => {
      const longContent = "a".repeat(500);
      const manager = {
        chat: vi.fn().mockResolvedValue({
          content: "Summary of long message.",
          usage: {},
        }),
      };
      const result = await summarizeHistoryChunk(
        [{ role: "user", content: longContent }],
        manager as never,
        { provider: "o", model: "m" }
      );
      expect(result).toBe("Summary of long message.");
      const call = vi.mocked(manager.chat).mock.calls[0][1];
      const userMsg = call.messages?.find((m: { role: string }) => m.role === "user");
      expect(userMsg?.content).toContain("a".repeat(400));
      expect(userMsg?.content).toContain("…");
    });

    it("does not add ellipsis when message content length <= 400", async () => {
      const shortContent = "a".repeat(300);
      const manager = {
        chat: vi.fn().mockResolvedValue({
          content: "Summary.",
          usage: {},
        }),
      };
      await summarizeHistoryChunk([{ role: "user", content: shortContent }], manager as never, {
        provider: "o",
        model: "m",
      });
      const call = vi.mocked(manager.chat).mock.calls[0][1];
      const userMsg = call.messages?.find((m: { role: string }) => m.role === "user");
      expect(userMsg?.content).toBe("user: " + shortContent);
      expect(userMsg?.content).not.toContain("…");
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

    it("uses trimmed and applyRephraseFixes when LLM returns empty content (else branch)", async () => {
      const manager = {
        chat: vi.fn().mockResolvedValue({ content: "", usage: {} }),
      };
      const result = await rephraseAndClassify("hello world", manager as never, {
        provider: "openai",
        model: "gpt-4",
      });
      expect(result.rephrasedPrompt).toBe(applyRephraseFixes("hello world"));
      expect(result.wantsRetry).toBe(false);
    });

    it("uses raw content when no rephrased tag and applies applyRephraseFixes when result equals trimmed", async () => {
      const manager = {
        chat: vi.fn().mockResolvedValue({
          content: "hello world<wants_retry>no</wants_retry>",
          usage: {},
        }),
      };
      const result = await rephraseAndClassify("hello world", manager as never, {
        provider: "openai",
        model: "gpt-4",
      });
      expect(result.rephrasedPrompt).toBeDefined();
      expect(result.wantsRetry).toBe(false);
      const managerSame = {
        chat: vi.fn().mockResolvedValue({
          content: "hello world",
          usage: {},
        }),
      };
      const resultSame = await rephraseAndClassify("hello world", managerSame as never, {
        provider: "openai",
        model: "gpt-4",
      });
      expect(resultSame.rephrasedPrompt).toBe(applyRephraseFixes("hello world"));
    });

    it("uses raw content without rephrased tag when LLM returns text with no tags", async () => {
      const manager = {
        chat: vi.fn().mockResolvedValue({
          content: "Rephrased: what is the issue?",
          usage: {},
        }),
      };
      const result = await rephraseAndClassify("what is the issue", manager as never, {
        provider: "openai",
        model: "gpt-4",
      });
      expect(result.rephrasedPrompt).toBeDefined();
      expect(result.wantsRetry).toBe(false);
    });

    it("calls onLlmCall when provided and LLM returns", async () => {
      const manager = {
        chat: vi.fn().mockResolvedValue({
          content: " <rephrased>paraphrase</rephrased><wants_retry>no</wants_retry> ",
          usage: { promptTokens: 10, completionTokens: 5 },
        }),
      };
      const onLlmCall = vi.fn();
      await rephraseAndClassify(
        "user msg",
        manager as never,
        {
          provider: "openai",
          model: "gpt-4",
        },
        { onLlmCall }
      );
      expect(onLlmCall).toHaveBeenCalledOnce();
      expect(onLlmCall.mock.calls[0][0]).toMatchObject({
        phase: "rephrase",
        messageCount: 2,
        lastUserContent: "user msg",
        responseContent: expect.any(String),
        usage: { promptTokens: 10, completionTokens: 5 },
      });
    });
  });
});
