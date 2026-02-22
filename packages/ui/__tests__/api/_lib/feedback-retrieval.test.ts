import { describe, it, expect, vi } from "vitest";
import {
  feedbackToEmbeddingText,
  getRelevantFeedbackForScope,
  embedFeedbackOnCreate,
} from "../../../app/api/_lib/feedback-retrieval";

vi.mock("../../../app/api/_lib/rag", () => ({
  getDeploymentCollectionId: vi.fn().mockResolvedValue(null),
  retrieveChunks: vi.fn(),
}));

describe("feedback-retrieval", () => {
  describe("feedbackToEmbeddingText", () => {
    it("combines input, output, label and notes", () => {
      const fb = {
        id: "f1",
        targetType: "chat",
        targetId: "chat",
        input: "user question",
        output: "assistant answer",
        label: "good",
        notes: "helpful",
      };
      expect(feedbackToEmbeddingText(fb)).toContain("user question");
      expect(feedbackToEmbeddingText(fb)).toContain("assistant answer");
      expect(feedbackToEmbeddingText(fb)).toContain("good");
      expect(feedbackToEmbeddingText(fb)).toContain("helpful");
    });

    it("stringifies non-string input and output", () => {
      const fb = {
        id: "f2",
        targetType: "agent",
        targetId: "a1",
        input: { foo: 1 },
        output: [1, 2],
        label: "bad",
        notes: null,
      };
      const text = feedbackToEmbeddingText(fb);
      expect(text).toContain('"foo":1');
      expect(text).toContain("1,2");
      expect(text).toContain("bad");
    });

    it("caps total length at 2000 chars", () => {
      const long = "x".repeat(1000);
      const fb = {
        id: "f3",
        targetType: "chat",
        targetId: "chat",
        input: long,
        output: long,
        label: "good",
        notes: null,
      };
      const text = feedbackToEmbeddingText(fb);
      expect(text.length).toBeLessThanOrEqual(2000);
      expect(text.endsWith("…") || text.length <= 2000).toBe(true);
    });

    it("handles empty or null notes", () => {
      const fb = {
        id: "f4",
        targetType: "chat",
        targetId: "chat",
        input: "q",
        output: "a",
        label: "good",
        notes: undefined,
      };
      expect(feedbackToEmbeddingText(fb)).toBeTruthy();
    });

    it("uses empty string for null input and output", () => {
      const fb = {
        id: "f5",
        targetType: "chat",
        targetId: "chat",
        input: null,
        output: null,
        label: "label",
        notes: null,
      };
      const text = feedbackToEmbeddingText(fb);
      expect(text).toContain("label");
      expect(text).toBeTruthy();
    });

    it("returns combined as-is when length exactly 2000", () => {
      const fb = {
        id: "f6",
        targetType: "chat",
        targetId: "chat",
        input: "a".repeat(1995),
        output: "",
        label: "x",
        notes: null,
      };
      const text = feedbackToEmbeddingText(fb);
      expect(text.length).toBe(2000);
      expect(text.endsWith("…")).toBe(false);
    });
  });

  describe("getRelevantFeedbackForScope", () => {
    it("returns null when no deployment collection", async () => {
      const result = await getRelevantFeedbackForScope("chat", "chat", "query", 5);
      expect(result).toBeNull();
    });
  });

  describe("embedFeedbackOnCreate", () => {
    it("does not throw when no deployment collection", async () => {
      await expect(
        embedFeedbackOnCreate({
          id: "fb1",
          targetType: "chat",
          targetId: "chat",
          input: "q",
          output: "a",
          label: "good",
          notes: null,
        })
      ).resolves.toBeUndefined();
    });
  });
});
