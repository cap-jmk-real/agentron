/**
 * E2E: RAG in chat — when a deployment collection has ingested chunks, one chat turn uses RAG context.
 * Skips when no deployment collection or no chunks (no ingest); otherwise runs chat and asserts response.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { POST as chatPost } from "../../app/api/chat/route";
import { GET as getChatEvents } from "../../app/api/chat/events/route";
import { POST as convPost } from "../../app/api/chat/conversations/route";
import { getDeploymentCollectionId, retrieveChunks } from "../../app/api/_lib/rag";
import { E2E_LLM_CONFIG_ID } from "./e2e-setup";
import { e2eLog } from "./e2e-logger";

async function readEventStream(turnId: string): Promise<{ type?: string; content?: string }[]> {
  const res = await getChatEvents(
    new Request(`http://localhost/api/chat/events?turnId=${encodeURIComponent(turnId)}`)
  );
  if (!res.ok || !res.body) return [];
  const decoder = new TextDecoder();
  let buffer = "";
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value);
    if (done) break;
  }
  reader.releaseLock();
  const events: { type?: string; content?: string }[] = [];
  for (const chunk of buffer.split("\n\n").filter((s) => s.trim())) {
    const m = chunk.match(/^data:\s*(.+)$/m);
    if (m) {
      try {
        events.push(JSON.parse(m[1].trim()));
      } catch {
        // skip
      }
    }
  }
  return events;
}

describe("e2e rag-in-chat", () => {
  const start = Date.now();

  beforeAll(() => {
    e2eLog.startTest("rag-in-chat");
    e2eLog.scenario(
      "rag-in-chat",
      "Chat turn with RAG context when deployment collection has chunks"
    );
  });

  afterAll(() => {
    e2eLog.outcome("completed", Date.now() - start);
    e2eLog.endTest();
  });

  it("when deployment collection has chunks, chat response uses knowledge base", async () => {
    const collectionId = await getDeploymentCollectionId();
    if (!collectionId) {
      e2eLog.step("skip no deployment collection", {});
      return;
    }
    const chunks = await retrieveChunks(collectionId, "answer", 5);
    if (chunks.length === 0) {
      e2eLog.step("skip no ingested chunks", {});
      return;
    }
    e2eLog.step("deployment collection has chunks", { count: chunks.length });

    const createRes = await convPost(
      new Request("http://localhost/api/chat/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "E2E RAG" }),
      })
    );
    const conv = await createRes.json();
    const conversationId = conv.id as string;

    const res = await chatPost(
      new Request("http://localhost/api/chat?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          message: "What is in the knowledge base? Summarize briefly.",
          conversationId,
          providerId: E2E_LLM_CONFIG_ID,
          useHeapMode: false,
        }),
      })
    );
    expect(res).toBeDefined();
    expect(res!.status).toBe(202);
    const data = await res!.json();
    const turnId = data.turnId;

    const events = await readEventStream(turnId);
    const doneEvent = events.find((e) => e?.type === "done");
    expect(doneEvent).toBeDefined();
    const content = (doneEvent as { content?: string })?.content ?? "";
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
    e2eLog.toolCall("chat with RAG", `content length: ${content.length}`);
  }, 90_000);
});
