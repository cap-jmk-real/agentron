import { describe, it, expect } from "vitest";
import { getConversationIdFromSearchParams } from "../../app/lib/chat-url-params";

describe("chat-url-params", () => {
  describe("getConversationIdFromSearchParams", () => {
    it("returns conversation id from get param so /chat?conversation=:id selects that conversation", () => {
      const get = (k: string) => (k === "conversation" ? "conv-123" : null);
      expect(getConversationIdFromSearchParams(get)).toBe("conv-123");
    });

    it("returns null when conversation param is missing", () => {
      const get = (_k: string) => null;
      expect(getConversationIdFromSearchParams(get)).toBe(null);
    });

    it("trims whitespace and returns null for empty string", () => {
      const get = (k: string) => (k === "conversation" ? "  " : null);
      expect(getConversationIdFromSearchParams(get)).toBe(null);
      const get2 = (k: string) => (k === "conversation" ? "  conv-456  " : null);
      expect(getConversationIdFromSearchParams(get2)).toBe("conv-456");
    });

    it("returns null when get returns non-string", () => {
      const get = (k: string) => (k === "conversation" ? (undefined as unknown as string) : null);
      expect(getConversationIdFromSearchParams(get)).toBe(null);
    });
  });
});
