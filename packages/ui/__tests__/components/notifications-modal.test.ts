import { describe, it, expect } from "vitest";
import { getNotificationItemHref } from "../../app/components/notifications-modal";

describe("Notifications modal", () => {
  describe("getNotificationItemHref", () => {
    it("returns /runs/:id for run notifications so user can open the run", () => {
      expect(getNotificationItemHref({ type: "run", sourceId: "run-123" })).toBe("/runs/run-123");
      expect(getNotificationItemHref({ type: "run", sourceId: "abc" })).toBe("/runs/abc");
    });

    it("returns /chat?conversation=:id for chat notifications so user is guided to the conversation", () => {
      expect(getNotificationItemHref({ type: "chat", sourceId: "conv-456" })).toBe(
        "/chat?conversation=conv-456"
      );
      expect(getNotificationItemHref({ type: "chat", sourceId: "xyz" })).toBe(
        "/chat?conversation=xyz"
      );
    });

    it("returns # for system or unknown type", () => {
      expect(getNotificationItemHref({ type: "system", sourceId: "sys-1" })).toBe("#");
      expect(getNotificationItemHref({ type: "other", sourceId: "id" })).toBe("#");
    });
  });
});
