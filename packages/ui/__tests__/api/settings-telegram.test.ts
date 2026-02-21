import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET, PATCH } from "../../app/api/settings/telegram/route";
import { POST as testPost } from "../../app/api/settings/telegram/test/route";
import * as telegramSettings from "../../app/api/_lib/telegram-settings";

describe("Settings Telegram API", () => {
  beforeEach(async () => {
    await PATCH(
      new Request("http://localhost/api/settings/telegram", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false, botToken: "", notificationChatId: "" }),
      })
    );
  });

  it("GET /api/settings/telegram returns 500 when getTelegramSettings throws", async () => {
    vi.spyOn(telegramSettings, "getTelegramSettings").mockImplementationOnce(() => {
      throw new Error("read fail");
    });
    const res = await GET();
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("read fail");
    vi.restoreAllMocks();
  });

  it("GET /api/settings/telegram returns 500 with generic message when thrown value is not Error", async () => {
    vi.spyOn(telegramSettings, "getTelegramSettings").mockImplementationOnce(() => {
      throw "string error";
    });
    const res = await GET();
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Failed to load Telegram settings");
    vi.restoreAllMocks();
  });

  it("GET /api/settings/telegram returns shape without token", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.enabled).toBe("boolean");
    expect(typeof data.hasToken).toBe("boolean");
    expect(data.hasToken).toBe(false);
    expect(data).not.toHaveProperty("botToken");
  });

  it("PATCH /api/settings/telegram updates enabled", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/settings/telegram", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.enabled).toBe(true);
    const getRes = await GET();
    const getData = await getRes.json();
    expect(getData.enabled).toBe(true);
  });

  it("PATCH /api/settings/telegram with botToken sets hasToken", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/settings/telegram", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken: "test-token-123" }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.hasToken).toBe(true);
    expect(data).not.toHaveProperty("botToken");
  });

  it("PATCH /api/settings/telegram returns 500 when updateTelegramSettings throws", async () => {
    vi.spyOn(telegramSettings, "updateTelegramSettings").mockImplementationOnce(() => {
      throw new Error("write fail");
    });
    const res = await PATCH(
      new Request("http://localhost/api/settings/telegram", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      })
    );
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("write fail");
    vi.restoreAllMocks();
  });

  it("PATCH /api/settings/telegram returns 500 with generic message when thrown value is not Error", async () => {
    vi.spyOn(telegramSettings, "updateTelegramSettings").mockImplementationOnce(() => {
      throw 123;
    });
    const res = await PATCH(
      new Request("http://localhost/api/settings/telegram", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      })
    );
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Failed to update Telegram settings");
    vi.restoreAllMocks();
  });

  it("PATCH /api/settings/telegram with usePolling false stops polling", async () => {
    await PATCH(
      new Request("http://localhost/api/settings/telegram", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usePolling: true }),
      })
    );
    const res = await PATCH(
      new Request("http://localhost/api/settings/telegram", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usePolling: false }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.usePolling).toBe(false);
  });

  it("PATCH /api/settings/telegram updates notificationChatId", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/settings/telegram", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationChatId: "123456789" }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.notificationChatId).toBe("123456789");
  });

  it("POST /api/settings/telegram/test returns 400 when no token", async () => {
    const res = await testPost(
      new Request("http://localhost/api/settings/telegram/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toContain("No token");
  });

  it("POST /api/settings/telegram/test with invalid token returns ok false", async () => {
    const res = await testPost(
      new Request("http://localhost/api/settings/telegram/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "invalid" }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toBeDefined();
  });

  it("POST /api/settings/telegram/test with valid mock token returns ok true", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      if (u.includes("getMe")) {
        return new Response(JSON.stringify({ ok: true, result: { username: "TestBot" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return originalFetch(url as Request);
    });

    try {
      const res = await testPost(
        new Request("http://localhost/api/settings/telegram/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: "mock-valid-token" }),
        })
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.username).toBe("@TestBot");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("POST /api/settings/telegram/test returns 500 when fetch throws", async () => {
    await PATCH(
      new Request("http://localhost/api/settings/telegram", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken: "token-for-fail" }),
      })
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));
    try {
      const res = await testPost(
        new Request("http://localhost/api/settings/telegram/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        })
      );
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain("Network error");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("POST /api/settings/telegram/test returns ok false when Telegram API returns ok false", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: false, description: "Unauthorized" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );
    try {
      const res = await testPost(
        new Request("http://localhost/api/settings/telegram/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: "some-token" }),
        })
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toBe("Unauthorized");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("POST /api/settings/telegram/test returns ok true with username undefined when result has no username", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, result: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );
    try {
      const res = await testPost(
        new Request("http://localhost/api/settings/telegram/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: "mock-token" }),
        })
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.username).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
