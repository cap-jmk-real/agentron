import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET, PATCH } from "../../app/api/settings/telegram/route";
import { POST as testPost } from "../../app/api/settings/telegram/test/route";

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
});
