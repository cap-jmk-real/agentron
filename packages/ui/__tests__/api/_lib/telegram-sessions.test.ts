import { describe, it, expect, beforeEach } from "vitest";
import { getConversationId, setConversationId } from "../../../app/api/_lib/telegram-sessions";

describe("telegram-sessions", () => {
  beforeEach(() => {
    setConversationId("123", "conv-a");
  });

  it("getConversationId returns undefined for unknown chat", () => {
    expect(getConversationId("999")).toBeUndefined();
  });

  it("getConversationId returns set value", () => {
    expect(getConversationId("123")).toBe("conv-a");
  });

  it("setConversationId overwrites", () => {
    setConversationId("123", "conv-b");
    expect(getConversationId("123")).toBe("conv-b");
  });
});
