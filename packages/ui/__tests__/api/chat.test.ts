import { describe, it, expect, vi } from "vitest";
import { GET, POST as chatPost } from "../../app/api/chat/route";
import { POST as convPost } from "../../app/api/chat/conversations/route";
import { db, llmConfigs, toLlmConfigRow } from "../../app/api/_lib/db";
import { eq } from "drizzle-orm";

const FIXTURE_LLM_ID = "fixture-llm-abort-test";

vi.mock("@agentron-studio/runtime", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    createDefaultLLMManager: () => ({
      chat: async () => {
        await new Promise((r) => setTimeout(r, 300));
        return { content: "Fixture reply from mock LLM", usage: undefined };
      },
    }),
  };
});

describe("Chat API", () => {
  it("GET /api/chat returns messages array", async () => {
    const res = await GET(new Request("http://localhost/api/chat"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("GET /api/chat?conversationId=id returns messages for conversation", async () => {
    const createRes = await convPost(
      new Request("http://localhost/api/chat/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Chat get test" }),
      })
    );
    const conv = await createRes.json();
    const res = await GET(new Request(`http://localhost/api/chat?conversationId=${conv.id}`));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("aborting streaming chat releases lock so second request does not hang", async () => {
    try {
      await db.delete(llmConfigs).where(eq(llmConfigs.id, FIXTURE_LLM_ID)).run();
    } catch {
      // ignore
    }
    await db
      .insert(llmConfigs)
      .values(toLlmConfigRow({ id: FIXTURE_LLM_ID, provider: "openai", model: "gpt-4" } as Parameters<typeof toLlmConfigRow>[0]))
      .run();

    const createRes = await convPost(
      new Request("http://localhost/api/chat/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Abort test" }),
      })
    );
    const conv = await createRes.json();
    const conversationId = conv.id as string;
    expect(conversationId).toBeDefined();

    const ac = new AbortController();
    const req = new Request("http://localhost/api/chat?stream=1", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        message: "stop me",
        conversationId,
        providerId: FIXTURE_LLM_ID,
      }),
      signal: ac.signal,
    });

    const res = await chatPost(req);
    expect(res.status).toBe(200);
    expect(res.body).toBeTruthy();

    const reader = res.body!.getReader();
    const readUntilAbort = async () => {
      try {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      } catch {
        // AbortError or stream error expected
      } finally {
        reader.releaseLock();
      }
    };
    const readPromise = readUntilAbort();
    await new Promise((r) => setTimeout(r, 80));
    ac.abort();
    await readPromise;

    const getRes = await GET(new Request(`http://localhost/api/chat?conversationId=${conversationId}`));
    expect(getRes.status).toBe(200);
    const messages = await getRes.json();
    expect(Array.isArray(messages)).toBe(true);

    const secondRes = await Promise.race([
      chatPost(
        new Request("http://localhost/api/chat?stream=1", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({
            message: "second message",
            conversationId,
            providerId: FIXTURE_LLM_ID,
          }),
        })
      ),
      new Promise<Response>((_, reject) =>
        setTimeout(() => reject(new Error("Second request hung (lock not released)")), 10_000)
      ),
    ]);
    expect([200, 500]).toContain(secondRes.status);
    if (secondRes.body) {
      const r = secondRes.body.getReader();
      try {
        while (true) {
          const { done } = await r.read();
          if (done) break;
        }
      } finally {
        r.releaseLock();
      }
    }
  }, 15_000);
});
