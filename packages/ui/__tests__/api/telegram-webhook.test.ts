import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "../../app/api/telegram/webhook/route";
import { PATCH } from "../../app/api/settings/telegram/route";

describe("Telegram webhook API", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await PATCH(
      new Request("http://localhost/api/settings/telegram", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken: "webhook-test-token" }),
      })
    );
    mockFetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : (input as URL).href;
      if (url.includes("/api/llm/providers")) {
        return new Response(JSON.stringify([{ id: "provider-1" }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/chat")) {
        return new Response(JSON.stringify({ assistantContent: "Agentron reply" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("api.telegram.org") && url.includes("sendMessage")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(null, { status: 404 });
    });
    globalThis.fetch = mockFetch;
  });

  it("POST /api/telegram/webhook returns 503 when no token", async () => {
    await PATCH(
      new Request("http://localhost/api/settings/telegram", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken: "" }),
      })
    );
    const res = await POST(
      new Request("http://localhost:3000/api/telegram/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: { chat: { id: 123 }, text: "Hi" } }),
      })
    );
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toContain("not configured");
  });

  it("POST /api/telegram/webhook returns 200 and sends reply", async () => {
    const res = await POST(
      new Request("http://localhost:3000/api/telegram/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: { chat: { id: 123 }, text: "Hello" } }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    const sendMessageCalls = mockFetch.mock.calls.filter(
      (c) => (typeof c[0] === "string" && c[0].includes("sendMessage")) || (c[0] instanceof Request && c[0].url.includes("sendMessage"))
    );
    expect(sendMessageCalls.length).toBeGreaterThanOrEqual(1);
    const lastCall = sendMessageCalls[sendMessageCalls.length - 1];
    const init = lastCall[1];
    const body = init?.body ? JSON.parse(typeof init.body === "string" ? init.body : await (init.body as Blob).text()) : {};
    expect(body.text).toBe("Agentron reply");
    expect(body.chat_id).toBe(123);
  });

  it("POST /api/telegram/webhook with empty message text sends hint", async () => {
    const res = await POST(
      new Request("http://localhost:3000/api/telegram/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: { chat: { id: 456 } } }),
      })
    );
    expect(res.status).toBe(200);
    const sendMessageCalls = mockFetch.mock.calls.filter(
      (c) => (typeof c[0] === "string" && c[0].includes("sendMessage")) || (c[0] instanceof Request && c[0].url.includes("sendMessage"))
    );
    expect(sendMessageCalls.length).toBe(1);
    const init = sendMessageCalls[0][1];
    const body = init?.body ? JSON.parse(typeof init.body === "string" ? init.body : await (init.body as Blob).text()) : {};
    expect(body.text).toContain("text message");
  });

  it("POST /api/telegram/webhook returns 401 when secret required and wrong", async () => {
    const orig = process.env.TELEGRAM_WEBHOOK_SECRET;
    process.env.TELEGRAM_WEBHOOK_SECRET = "my-secret";
    try {
      const res = await POST(
        new Request("http://localhost:3000/api/telegram/webhook?secret=wrong", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: { chat: { id: 123 }, text: "Hi" } }),
        })
      );
      expect(res.status).toBe(401);
    } finally {
      process.env.TELEGRAM_WEBHOOK_SECRET = orig;
    }
  });
});
