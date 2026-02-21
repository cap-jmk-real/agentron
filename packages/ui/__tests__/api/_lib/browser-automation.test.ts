import { describe, it, expect, vi, beforeEach } from "vitest";
import { browserAutomation } from "../../../app/api/_lib/browser-automation";

function createMockPage(overrides: Record<string, unknown> = {}) {
  return {
    setDefaultTimeout: vi.fn(),
    url: () => "",
    content: () => "",
    title: () => Promise.resolve(""),
    locator: () => ({ first: () => ({ innerText: () => Promise.resolve("") }) }),
    goto: () => Promise.resolve(),
    click: () => Promise.resolve(),
    fill: () => Promise.resolve(),
    screenshot: () => Promise.resolve(Buffer.from("")),
    waitForSelector: () => Promise.resolve(),
    ...overrides,
  };
}

function createMockBrowser(page = createMockPage()) {
  return {
    contexts: () => [{ pages: () => [page] }],
    close: () => Promise.resolve(),
  };
}

vi.mock("playwright", () => ({
  chromium: {
    connectOverCDP: vi.fn(),
  },
}));

describe("browser-automation", () => {
  beforeEach(async () => {
    const playwright = await import("playwright");
    vi.mocked(playwright.chromium.connectOverCDP).mockReset();
  });

  describe("input validation", () => {
    it("returns error when input is null", async () => {
      const result = await browserAutomation(null);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Input must be an object with action");
    });

    it("returns error when input is not an object", async () => {
      const result = await browserAutomation("string");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Input must be an object with action");
    });

    it("returns error when action is missing", async () => {
      const result = await browserAutomation({});
      expect(result.success).toBe(false);
      expect(result.error).toContain("action must be one of:");
    });

    it("returns error when action is invalid", async () => {
      const result = await browserAutomation({ action: "invalid" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("navigate");
      expect(result.error).toContain("click");
    });
  });

  describe("with mocked Playwright (getPage succeeds)", () => {
    beforeEach(async () => {
      const playwright = await import("playwright");
      vi.mocked(playwright.chromium.connectOverCDP).mockResolvedValue(
        createMockBrowser() as unknown as Awaited<
          ReturnType<typeof playwright.chromium.connectOverCDP>
        >
      );
    });

    it("returns error for navigate without url", async () => {
      const result = await browserAutomation({ action: "navigate" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("url is required for action navigate");
    });

    it("returns error for click without selector", async () => {
      const result = await browserAutomation({ action: "click" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("selector is required for action click");
    });

    it("returns error for fill without selector", async () => {
      const result = await browserAutomation({ action: "fill", value: "x" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("selector is required for action fill");
    });

    it("returns error for waitFor without selector", async () => {
      const result = await browserAutomation({ action: "waitFor" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("selector is required for action waitFor");
    });

    it("parses custom cdpUrl, timeout, minActionIntervalMs", async () => {
      const result = await browserAutomation({
        action: "navigate",
        url: "https://example.com",
        cdpUrl: "http://127.0.0.1:9223",
        timeout: 5000,
        minActionIntervalMs: 1000,
      });
      expect(result.success).toBe(true);
      expect(result.content).toBeDefined();
    });

    it("getContent returns success with content from page", async () => {
      const result = await browserAutomation({ action: "getContent" });
      expect(result.success).toBe(true);
      expect(result.content).toBeDefined();
    });

    it("screenshot returns success with data URL", async () => {
      const result = await browserAutomation({ action: "screenshot" });
      expect(result.success).toBe(true);
      expect(result.screenshot).toMatch(/^data:image\/png;base64,/);
    });
  });

  describe("when getPage fails (no Chrome)", () => {
    it("returns error with hint when connection refused", async () => {
      const playwright = await import("playwright");
      vi.mocked(playwright.chromium.connectOverCDP).mockRejectedValue(
        new Error("ECONNREFUSED connection refused")
      );
      // Prevent tryLaunchChrome() from spawning real Chrome (which would leave tabs open)
      const orig = process.env.AGENTRON_SKIP_CHROME_LAUNCH;
      process.env.AGENTRON_SKIP_CHROME_LAUNCH = "1";
      try {
        const result = await browserAutomation({
          action: "navigate",
          url: "https://example.com",
        });
        expect(result.success).toBe(false);
        expect(result.error).toContain("ECONNREFUSED");
      } finally {
        if (orig !== undefined) process.env.AGENTRON_SKIP_CHROME_LAUNCH = orig;
        else delete process.env.AGENTRON_SKIP_CHROME_LAUNCH;
      }
    });
  });
});
