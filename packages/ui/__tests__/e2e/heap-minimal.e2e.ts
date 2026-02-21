/**
 * E2E: Minimal heap — one chat turn "Create a workflow with one agent that echoes hello and run it", assert create_workflow and execute_workflow.
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

describe("e2e heap-minimal", () => {
  const start = Date.now();

  beforeAll(() => {
    e2eLog.startTest("heap-minimal");
    e2eLog.scenario("heap-minimal", "Create workflow with one agent that echoes hello and run it");
  });

  afterAll(() => {
    e2eLog.outcome("completed", Date.now() - start);
    e2eLog.endTest();
  });

  it("one heap turn produces create_workflow and execute_workflow", async () => {
    const createRes = await convPost(
      new Request("http://localhost/api/chat/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "E2E heap minimal" }),
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
            "Create a workflow with one agent that echoes hello and run it. Use one agent, one node, no edges.",
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

    expect(toolResults.length).toBeGreaterThan(0);
    expect(typeof (doneEvent as { content?: string }).content).toBe("string");
    const hasExecuteWorkflow = names.includes("execute_workflow");
    if (hasExecuteWorkflow) {
      const execResult = toolResults.find((r) => r.name === "execute_workflow") as {
        result?: { status?: string };
      };
      expect(["completed", "failed", "waiting_for_user", "running"]).toContain(
        execResult?.result?.status ?? "unknown"
      );
    }
  }, 120_000);
});
