import fs from "node:fs";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
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

  it("getConversationId returns undefined when sessions file does not exist", () => {
    const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(false);
    try {
      expect(getConversationId("123")).toBeUndefined();
    } finally {
      existsSpy.mockRestore();
    }
  });

  it("getConversationId returns empty object when file content is invalid JSON", () => {
    const readSpy = vi.spyOn(fs, "readFileSync").mockReturnValue("not valid json");
    const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(true);
    try {
      expect(getConversationId("123")).toBeUndefined();
    } finally {
      readSpy.mockRestore();
      existsSpy.mockRestore();
    }
  });
});
