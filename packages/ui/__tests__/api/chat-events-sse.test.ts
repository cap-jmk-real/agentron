import { describe, it, expect, vi } from "vitest";
import { GET, POST as chatPost } from "../../app/api/chat/route";
import { GET as getChatEvents } from "../../app/api/chat/events/route";
import { POST as convPost } from "../../app/api/chat/conversations/route";
import { db, llmConfigs, toLlmConfigRow } from "../../app/api/_lib/db";
import { eq } from "drizzle-orm";

const FIXTURE_LLM_ID = "fixture-llm-abort-test";

vi.mock("@agentron-studio/runtime", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    createDefaultLLMManager: () => ({
      chat: async () => ({
        id: "mock",
        content: "Fixture reply from mock LLM",
        usage: undefined,
        raw: { choices: [{ message: { content: "Fixture reply from mock LLM" } }] },
      }),
    }),
  };
});

describe("Chat events SSE", () => {
  it("GET /api/chat/events without turnId returns 400", async () => {
    const res = await getChatEvents(new Request("http://localhost/api/chat/events"));
    expect(res.status).toBe(400);
  });

  it("second GET with same turnId receives events and does not get Connection issue when first GET took the job", async () => {
    try {
      await db.delete(llmConfigs).where(eq(llmConfigs.id, FIXTURE_LLM_ID)).run();
    } catch {
      // ignore
    }
    await db
      .insert(llmConfigs)
      .values(
        toLlmConfigRow({ id: FIXTURE_LLM_ID, provider: "openai", model: "gpt-4" } as Parameters<
          typeof toLlmConfigRow
        >[0])
      )
      .run();

    const createRes = await convPost(
      new Request("http://localhost/api/chat/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Events double-subscribe test" }),
      })
    );
    const conv = await createRes.json();
    const conversationId = conv.id as string;

    const postRes = await chatPost(
      new Request("http://localhost/api/chat?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          message: "hi",
          conversationId,
          providerId: FIXTURE_LLM_ID,
        }),
      })
    );
    expect(postRes).toBeDefined();
    expect(postRes!.status).toBe(202);
    const { turnId } = await postRes!.json();
    expect(typeof turnId).toBe("string");

    const firstGetRes = await getChatEvents(
      new Request(`http://localhost/api/chat/events?turnId=${encodeURIComponent(turnId)}`)
    );
    expect(firstGetRes.ok).toBe(true);

    const secondGetRes = await getChatEvents(
      new Request(`http://localhost/api/chat/events?turnId=${encodeURIComponent(turnId)}`)
    );
    expect(secondGetRes.ok).toBe(true);

    const reader = secondGetRes.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (value) buffer += decoder.decode(value);
        if (done) break;
      }
    } finally {
      reader.releaseLock();
    }

    const lines = buffer.split("\n\n").filter((s) => s.trim());
    const events: { type?: string; error?: string }[] = [];
    for (const line of lines) {
      const m = line.match(/^data:\s*(.+)$/m);
      if (m) {
        try {
          events.push(JSON.parse(m[1].trim()));
        } catch {
          //
        }
      }
    }

    const connectionIssueError = events.find(
      (e) =>
        e?.type === "error" && typeof e?.error === "string" && e.error.includes("Connection issue")
    );
    expect(connectionIssueError).toBeUndefined();

    const doneOrError = events.find((e) => e?.type === "done" || e?.type === "error");
    expect(events.length).toBeGreaterThan(0);
    expect(doneOrError?.type).toBe("done");
  }, 15_000);

  it("fallback runs job when no GET /api/chat/events connects (e.g. after Retry)", async () => {
    try {
      await db.delete(llmConfigs).where(eq(llmConfigs.id, FIXTURE_LLM_ID)).run();
    } catch {
      // ignore
    }
    await db
      .insert(llmConfigs)
      .values(
        toLlmConfigRow({ id: FIXTURE_LLM_ID, provider: "openai", model: "gpt-4" } as Parameters<
          typeof toLlmConfigRow
        >[0])
      )
      .run();

    const createRes = await convPost(
      new Request("http://localhost/api/chat/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Fallback job test" }),
      })
    );
    const conv = await createRes.json();
    const conversationId = conv.id as string;

    const getBeforeRes = await GET(
      new Request(`http://localhost/api/chat?conversationId=${conversationId}`)
    );
    expect(getBeforeRes.status).toBe(200);
    const messagesBefore = await getBeforeRes.json();
    const countBefore = Array.isArray(messagesBefore) ? messagesBefore.length : 0;

    const postRes = await chatPost(
      new Request("http://localhost/api/chat?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          message: "hello fallback",
          conversationId,
          providerId: FIXTURE_LLM_ID,
        }),
      })
    );
    expect(postRes).toBeDefined();
    expect(postRes!.status).toBe(202);
    const { turnId } = await postRes!.json();
    expect(typeof turnId).toBe("string");

    const FALLBACK_MS = 4000;
    await new Promise((r) => setTimeout(r, FALLBACK_MS + 800));

    const getAfterRes = await GET(
      new Request(`http://localhost/api/chat?conversationId=${conversationId}`)
    );
    expect(getAfterRes.status).toBe(200);
    const messagesAfter = await getAfterRes.json();
    expect(Array.isArray(messagesAfter)).toBe(true);
    const countAfter = (messagesAfter as unknown[]).length;
    expect(countAfter).toBeGreaterThan(countBefore);
    const hasNewAssistant = (messagesAfter as { role: string }[]).some(
      (m) => m.role === "assistant"
    );
    expect(hasNewAssistant).toBe(true);
  }, 12_000);
});
