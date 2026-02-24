import { describe, it, expect } from "vitest";
import { shouldSkipLoadingFalseFromOtherTab } from "../../app/lib/chat-state-cache";

describe("chat-state-cache cross-tab guard", () => {
  describe("shouldSkipLoadingFalseFromOtherTab", () => {
    it("does not skip when counts are equal (stream-done completion from other tab)", () => {
      const state = { loading: true, messageCount: 5 };
      expect(shouldSkipLoadingFalseFromOtherTab(state, false, 5)).toBe(false);
    });

    it("skips when broadcast has fewer messages (stale update)", () => {
      const state = { loading: true, messageCount: 5 };
      expect(shouldSkipLoadingFalseFromOtherTab(state, false, 3)).toBe(true);
    });

    it("does not skip when we are not loading", () => {
      const state = { loading: false, messageCount: 5 };
      expect(shouldSkipLoadingFalseFromOtherTab(state, false, 3)).toBe(false);
    });

    it("does not skip when incoming data is still loading", () => {
      const state = { loading: true, messageCount: 5 };
      expect(shouldSkipLoadingFalseFromOtherTab(state, true, 5)).toBe(false);
    });

    it("does not skip when broadcast has more messages", () => {
      const state = { loading: true, messageCount: 5 };
      expect(shouldSkipLoadingFalseFromOtherTab(state, false, 7)).toBe(false);
    });
  });
});
