import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (...args: unknown[]) => mockRedirect(...args) }));

describe("requests page", () => {
  beforeEach(() => {
    mockRedirect.mockClear();
  });

  it("redirects to /queues?tab=requests", async () => {
    const RequestsPage = (await import("../../app/requests/page")).default;
    try {
      RequestsPage();
    } catch {
      // redirect() may throw in some Next.js versions
    }
    expect(mockRedirect).toHaveBeenCalledTimes(1);
    expect(mockRedirect).toHaveBeenCalledWith("/queues?tab=requests");
  });
});
