import { describe, it, expect } from "vitest";
import {
  getSuggestedOptionsFromToolResults,
  getSuggestedOptions,
} from "../../app/components/chat-message-content";

describe("options from ask_user only (LLM-formatted, no regex parsing)", () => {
  describe("getSuggestedOptionsFromToolResults", () => {
    it("returns options from ask_user result.options array", () => {
      const toolResults = [
        {
          name: "ask_user",
          args: {},
          result: { question: "Which one?", options: ["Yes", "No", "Cancel"] },
        },
      ];
      const opts = getSuggestedOptionsFromToolResults(toolResults, "fallback text");
      expect(opts).toHaveLength(3);
      expect(opts[0]).toEqual({ value: "Yes", label: "Yes" });
      expect(opts[1]).toEqual({ value: "No", label: "No" });
      expect(opts[2]).toEqual({ value: "Cancel", label: "Cancel" });
    });

    it("returns options from ask_credentials when present", () => {
      const toolResults = [
        {
          name: "ask_credentials",
          args: {},
          result: { question: "API key?", options: ["Provide now", "Skip"] },
        },
      ];
      const opts = getSuggestedOptionsFromToolResults(toolResults, "");
      expect(opts).toHaveLength(2);
      expect(opts.map((o) => o.label)).toEqual(["Provide now", "Skip"]);
    });

    it("returns empty when ask_user has no options array", () => {
      const toolResults = [
        { name: "ask_user", args: {}, result: { question: "Pick one: a) A b) B" } },
      ];
      const opts = getSuggestedOptionsFromToolResults(toolResults, "Pick one: a) A b) B");
      expect(opts).toEqual([]);
    });

    it("returns empty when only format_response is present", () => {
      const toolResults = [
        {
          name: "format_response",
          args: {},
          result: { formatted: true, summary: "Done.", needsInput: "What next?" },
        },
      ];
      const opts = getSuggestedOptionsFromToolResults(toolResults, "Choose: a) Run b) Edit");
      expect(opts).toEqual([]);
    });

    it("returns empty for undefined or non-array toolResults", () => {
      expect(getSuggestedOptionsFromToolResults(undefined, "a) One")).toEqual([]);
      expect(getSuggestedOptionsFromToolResults(null as unknown as undefined, "a) One")).toEqual(
        []
      );
    });

    it("returns empty for empty or whitespace-only fallback", () => {
      expect(getSuggestedOptionsFromToolResults([], "")).toEqual([]);
      expect(getSuggestedOptionsFromToolResults([], "   ")).toEqual([]);
    });
  });

  describe("getSuggestedOptions", () => {
    it("returns options from ask_user result when present", () => {
      const opts = getSuggestedOptions(
        { result: { question: "Which?", options: ["A", "B", "C"] } },
        "any text"
      );
      expect(opts).toHaveLength(3);
      expect(opts.map((o) => o.label)).toEqual(["A", "B", "C"]);
    });

    it("returns empty when no result or no options array", () => {
      expect(getSuggestedOptions(undefined, "Choose: a) One b) Two")).toEqual([]);
      expect(getSuggestedOptions({ result: { question: "What?" } }, "a) One")).toEqual([]);
    });
  });
});
