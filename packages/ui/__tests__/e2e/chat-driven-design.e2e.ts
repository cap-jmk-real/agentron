/**
 * E2E: Chat-driven design — one chat turn that should result in create_workflow, create_agent, execute_workflow.
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

describe("e2e chat-driven-design", () => {
  const start = Date.now();

  beforeAll(() => {
    e2eLog.startTest("chat-driven-design");
    e2eLog.scenario(
      "chat-driven-design",
      "Create workflow with one agent that fetches example.com, then run it"
    );
  });

  afterAll(() => {
    e2eLog.outcome("completed", Date.now() - start);
    e2eLog.endTest();
  });

  it("one chat turn produces create_agent/create_workflow and optionally execute_workflow", async () => {
    const createRes = await convPost(
      new Request("http://localhost/api/chat/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "E2E chat-driven" }),
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
          message:
            "Create a workflow with one agent that fetches https://example.com and replies with the page title. Then run it.",
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

    const hasCreateAgent = names.includes("create_agent");
    const hasCreateWorkflow = names.includes("create_workflow");
    const hasExecuteWorkflow = names.includes("execute_workflow");
    expect(hasCreateAgent || hasCreateWorkflow).toBe(true);
    if (hasExecuteWorkflow) {
      const execResult = toolResults.find((r) => r.name === "execute_workflow") as {
        result?: { status?: string };
      };
      expect(["completed", "failed", "waiting_for_user", "running"]).toContain(
        execResult?.result?.status ?? "unknown"
      );
    }
    expect(typeof (doneEvent as { content?: string }).content).toBe("string");
  }, 180_000);
});
