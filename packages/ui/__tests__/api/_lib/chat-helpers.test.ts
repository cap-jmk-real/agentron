import { describe, it, expect } from "vitest";
import {
  llmContextPrefix,
  normalizeChatError,
  normalizeOptionsWithLLM,
  normalizeAskUserOptionsInToolResults,
  extractOptionsFromContentWithLLM,
  hasWaitingForInputInToolResults,
} from "../../../app/api/_lib/chat-helpers";

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

  describe("normalizeOptionsWithLLM", () => {
    it("returns parsed JSON array when callLLM returns valid array", async () => {
      const callLLM = async () => '["Run it now", "Modify", "Not now"]';
      const out = await normalizeOptionsWithLLM(callLLM, ["Run it now", "Modify", "Not now"]);
      expect(out).toEqual(["Run it now", "Modify", "Not now"]);
    });

    it("returns original options when callLLM throws", async () => {
      const callLLM = async () => {
        throw new Error("Network error");
      };
      const options = ["A", "B"];
      const out = await normalizeOptionsWithLLM(callLLM, options);
      expect(out).toEqual(options);
    });

    it("returns original options when response is not valid JSON array", async () => {
      const callLLM = async () => "Here are the options: A, B";
      const options = ["A", "B"];
      const out = await normalizeOptionsWithLLM(callLLM, options);
      expect(out).toEqual(options);
    });

    it("returns empty array when input is empty", async () => {
      const callLLM = async () => "[]";
      const out = await normalizeOptionsWithLLM(callLLM, []);
      expect(out).toEqual([]);
    });
  });

  describe("normalizeAskUserOptionsInToolResults", () => {
    it("normalizes ask_user options via callLLM and returns new array", async () => {
      const callLLM = async () => '["Yes", "No"]';
      const toolResults = [
        { name: "ask_user", args: {}, result: { question: "Confirm?", options: ["Yes", "No"] } },
      ];
      const out = await normalizeAskUserOptionsInToolResults(toolResults, callLLM);
      expect(out).toHaveLength(1);
      expect((out[0].result as { options?: string[] }).options).toEqual(["Yes", "No"]);
    });

    it("leaves other tool results unchanged", async () => {
      const callLLM = async () => "[]";
      const toolResults = [
        { name: "list_workflows", args: {}, result: [] },
        { name: "ask_user", args: {}, result: { question: "Which?", options: ["A", "B"] } },
      ];
      const out = await normalizeAskUserOptionsInToolResults(toolResults, callLLM);
      expect(out).toHaveLength(2);
      expect(out[0].name).toBe("list_workflows");
      expect(out[1].name).toBe("ask_user");
    });

    it("leaves ask_user without options unchanged", async () => {
      const callLLM = async () => "[]";
      const toolResults = [{ name: "ask_user", args: {}, result: { question: "What?" } }];
      const out = await normalizeAskUserOptionsInToolResults(toolResults, callLLM);
      expect(out).toHaveLength(1);
      expect((out[0].result as { question: string }).question).toBe("What?");
    });
  });

  describe("extractOptionsFromContentWithLLM", () => {
    it("returns null when content does not suggest options", async () => {
      const callLLM = async () => '["A", "B"]';
      expect(await extractOptionsFromContentWithLLM("Just a normal message.", callLLM)).toBeNull();
      expect(await extractOptionsFromContentWithLLM("", callLLM)).toBeNull();
    });

    it("returns parsed options when content has pick one and callLLM returns JSON array", async () => {
      const callLLM = async () => '["Run it now", "Provide credentials", "Dry run only"]';
      const content = "Please pick one option: Run it now — start the workflow. Provide credentials — ...";
      const out = await extractOptionsFromContentWithLLM(content, callLLM);
      expect(out).toEqual(["Run it now", "Provide credentials", "Dry run only"]);
    });

    it("returns null when callLLM throws", async () => {
      const callLLM = async () => {
        throw new Error("fail");
      };
      const content = "Please pick one option: a) Yes b) No";
      expect(await extractOptionsFromContentWithLLM(content, callLLM)).toBeNull();
    });
  });

  describe("hasWaitingForInputInToolResults", () => {
    it("returns true for ask_user with waitingForUser true", () => {
      expect(
        hasWaitingForInputInToolResults([
          { name: "ask_user", result: { waitingForUser: true, question: "Confirm?" } },
        ])
      ).toBe(true);
    });

    it("returns true for ask_user with options array", () => {
      expect(
        hasWaitingForInputInToolResults([
          { name: "ask_user", result: { question: "Pick one", options: ["A", "B"] } },
        ])
      ).toBe(true);
    });

    it("returns true for ask_credentials with waitingForUser", () => {
      expect(
        hasWaitingForInputInToolResults([
          { name: "ask_credentials", result: { waitingForUser: true, credentialKey: "key" } },
        ])
      ).toBe(true);
    });

    it("returns true for format_response with formatted and needsInput", () => {
      expect(
        hasWaitingForInputInToolResults([
          { name: "format_response", result: { formatted: true, needsInput: "Choose an option" } },
        ])
      ).toBe(true);
    });

    it("returns false for ask_user without waitingForUser or options", () => {
      expect(
        hasWaitingForInputInToolResults([{ name: "ask_user", result: { question: "Open question" } }])
      ).toBe(false);
    });

    it("returns false for format_response without formatted or needsInput", () => {
      expect(
        hasWaitingForInputInToolResults([
          { name: "format_response", result: { formatted: true } },
        ])
      ).toBe(false);
      expect(
        hasWaitingForInputInToolResults([
          { name: "format_response", result: { needsInput: "x" } },
        ])
      ).toBe(false);
    });

    it("returns false for empty or non-waiting tool results", () => {
      expect(hasWaitingForInputInToolResults([])).toBe(false);
      expect(
        hasWaitingForInputInToolResults([{ name: "list_workflows", result: [] }])
      ).toBe(false);
    });
  });
});
