import { describe, it, expect, vi } from "vitest";
import {
  rephraseAndClassify,
  shouldSkipRephrase,
} from "../../../../app/api/chat/_lib/run-turn-helpers";

describe("run-turn-helpers", () => {
  describe("rephraseAndClassify", () => {
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
  });
});
