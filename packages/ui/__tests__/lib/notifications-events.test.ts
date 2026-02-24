import { describe, it, expect, vi, afterEach } from "vitest";
import {
  NOTIFICATIONS_UPDATED_EVENT,
  dispatchNotificationsUpdated,
} from "../../app/lib/notifications-events";

describe("notifications-events", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("NOTIFICATIONS_UPDATED_EVENT has expected value", () => {
    expect(NOTIFICATIONS_UPDATED_EVENT).toBe("agentron-notifications-updated");
  });

  it("dispatchNotificationsUpdated does nothing when window is undefined (Node)", () => {
    expect(() => dispatchNotificationsUpdated()).not.toThrow();
  });

  it("dispatchNotificationsUpdated dispatches CustomEvent when window is defined", () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    dispatchNotificationsUpdated();
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    const [event] = dispatchEvent.mock.calls[0];
    expect(event).toBeInstanceOf(CustomEvent);
    expect(event.type).toBe(NOTIFICATIONS_UPDATED_EVENT);
    vi.unstubAllGlobals();
  });
});
