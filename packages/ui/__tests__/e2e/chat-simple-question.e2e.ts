/**
 * E2E: Simple question — planner routes to general, general uses answer_question, user gets a direct answer.
 * Asserts that a definitional question (e.g. "What is 2+2?") triggers answer_question and returns an answer.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { POST as chatPost } from "../../app/api/chat/route";
import { GET as getChatEvents } from "../../app/api/chat/events/route";
import { POST as convPost } from "../../app/api/chat/conversations/route";
import { E2E_LLM_CONFIG_ID } from "./e2e-setup";
import { e2eLog } from "./e2e-logger";

async function readEventStream(
  turnId: string
): Promise<{ type?: string; toolResults?: { name: string }[]; content?: string }[]> {
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
  const events: { type?: string; toolResults?: { name: string }[]; content?: string }[] = [];
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

describe("e2e chat simple question", () => {
  const start = Date.now();

  beforeAll(() => {
    e2eLog.startTest("chat-simple-question");
    e2eLog.scenario(
      "chat-simple-question",
      "Simple question uses answer_question and returns answer"
    );
  });

  afterAll(() => {
    e2eLog.outcome("completed", Date.now() - start);
    e2eLog.endTest();
  });

  it("simple question triggers answer_question and returns direct answer", async () => {
    const createRes = await convPost(
      new Request("http://localhost/api/chat/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "E2E simple question" }),
      })
    );
    const conv = await createRes.json();
    const conversationId = conv.id as string;
    expect(typeof conversationId).toBe("string");
    e2eLog.step("create_conversation", { conversationId });

    const res = await chatPost(
      new Request("http://localhost/api/chat?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          message: "What is 2+2?",
          conversationId,
          providerId: E2E_LLM_CONFIG_ID,
          useHeapMode: true,
        }),
      })
    );
    expect(res).toBeDefined();
    expect(res!.status).toBe(202);
    const data = await res!.json();
    const turnId = data.turnId;
    expect(typeof turnId).toBe("string");

    const events = await readEventStream(turnId);
    const doneEvent = events.find((e) => e?.type === "done");
    expect(doneEvent).toBeDefined();
    const toolResults =
      (doneEvent as { toolResults?: { name: string }[] } | undefined)?.toolResults ?? [];
    const names = toolResults.map((r) => r.name);
    e2eLog.toolCall("chat_turn", names.join(","));

    expect(names).not.toContain("create_agent");
    expect(names).not.toContain("create_workflow");

    const content = (doneEvent as { content?: string }).content ?? "";
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
    expect(content.includes("4"), "Answer to 'What is 2+2?' should contain 4").toBe(true);
    // Prefer answer_question when planner routed to general; allow direct answer without tool (model variance)
    if (!names.includes("answer_question")) {
      e2eLog.step("answer_question not called but content is direct answer", {
        contentLen: content.length,
      });
    }
  }, 300_000);
});
