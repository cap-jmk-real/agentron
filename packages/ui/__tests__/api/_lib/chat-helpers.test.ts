import { describe, it, expect } from "vitest";
import { llmContextPrefix, normalizeChatError } from "../../../app/api/_lib/chat-helpers";

describe("chat-helpers", () => {
  describe("llmContextPrefix", () => {
    it("includes provider and model", () => {
      expect(llmContextPrefix({ provider: "openai", model: "gpt-4" })).toBe(
        "[Provider: openai, Model: gpt-4] "
      );
    });

    it("includes endpoint when present and non-empty", () => {
      expect(
        llmContextPrefix({ provider: "openai", model: "gpt-4", endpoint: "https://api.example.com" })
      ).toBe("[Provider: openai, Model: gpt-4, Endpoint: https://api.example.com] ");
    });

    it("omits endpoint when empty string", () => {
      expect(llmContextPrefix({ provider: "x", model: "y", endpoint: "" })).toBe(
        "[Provider: x, Model: y] "
      );
    });

    it("omits endpoint when only whitespace", () => {
      expect(llmContextPrefix({ provider: "x", model: "y", endpoint: "   " })).toBe(
        "[Provider: x, Model: y] "
      );
    });
  });

  describe("normalizeChatError", () => {
    it("returns generic message for network-style errors", () => {
      expect(normalizeChatError(new Error("fetch failed"))).toContain(
        "Could not reach the LLM"
      );
      expect(normalizeChatError(new Error("ECONNREFUSED"))).toContain(
        "Could not reach the LLM"
      );
      expect(normalizeChatError(new Error("ENOTFOUND"))).toContain(
        "Could not reach the LLM"
      );
      expect(normalizeChatError(new Error("network error"))).toContain(
        "Could not reach the LLM"
      );
    });

    it("appends tool execution hint for Cannot convert undefined or null to object", () => {
      const msg = normalizeChatError(
        new Error("Cannot convert undefined or null to object")
      );
      expect(msg).toContain("tool execution bug");
      expect(msg).toContain("Cannot convert undefined or null to object");
    });

    it("passes through other errors unchanged when no context", () => {
      expect(normalizeChatError(new Error("Something else"))).toBe("Something else");
    });

    it("prefixes with llm context when provided", () => {
      const out = normalizeChatError(new Error("fetch failed"), {
        provider: "openai",
        model: "gpt-4",
      });
      expect(out).toContain("[Provider: openai, Model: gpt-4] ");
      expect(out).toContain("Could not reach the LLM");
    });

    it("appends OpenAI docs link for openai provider and 404 in message", () => {
      const out = normalizeChatError(new Error("404 Not Found"), {
        provider: "openai",
        model: "gpt-4",
      });
      expect(out).toContain("platform.openai.com/docs/api-reference");
      expect(out).toContain("platform.openai.com/docs/overview");
    });

    it("does not append OpenAI docs for non-openai provider with 404", () => {
      const out = normalizeChatError(new Error("404"), {
        provider: "openrouter",
        model: "gpt-4",
      });
      expect(out).not.toContain("platform.openai.com");
    });

    it("handles non-Error throwables", () => {
      expect(normalizeChatError("string error")).toBe("string error");
    });
  });
});
