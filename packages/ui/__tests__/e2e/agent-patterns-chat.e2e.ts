/**
 * E2E: All agent and multi-agent patterns (including 2 custom) created via chat.
 * One heap turn per pattern using the first example prompt; asserts completion and optional structure.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { POST as chatPost } from "../../app/api/chat/route";
import { GET as getChatEvents } from "../../app/api/chat/events/route";
import { POST as convPost } from "../../app/api/chat/conversations/route";
import { executeTool } from "../../app/api/chat/_lib/execute-tool";
import { E2E_LLM_CONFIG_ID } from "./e2e-setup";
import { e2eLog } from "./e2e-logger";
import { AGENT_PATTERN_EXAMPLES, type PatternExample } from "../fixtures/agent-pattern-examples";

type ToolResult = { name: string; result?: { id?: string } };

async function readEventStream(
  turnId: string
): Promise<{ type?: string; toolResults?: ToolResult[]; content?: string }[]> {
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
  const events: { type?: string; toolResults?: ToolResult[]; content?: string }[] = [];
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

describe("e2e agent-patterns-chat", () => {
  const start = Date.now();

  beforeAll(() => {
    e2eLog.startTest("agent-patterns-chat");
    e2eLog.scenario(
      "agent-patterns-chat",
      "All agent/multi-agent patterns created via chat (heap)"
    );
  });

  afterAll(() => {
    e2eLog.outcome("completed", Date.now() - start);
    e2eLog.endTest();
  });

  for (const pattern of AGENT_PATTERN_EXAMPLES) {
    it(`chat creates pattern: ${pattern.patternId} (${pattern.level})`, async () => {
      const prompt = pattern.prompts[0];
      const createRes = await convPost(
        new Request("http://localhost/api/chat/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: `E2E pattern ${pattern.patternId}` }),
        })
      );
      const conv = await createRes.json();
      const conversationId = conv.id as string;
      expect(typeof conversationId).toBe("string");
      e2eLog.step("create_conversation", { patternId: pattern.patternId });

      const res = await chatPost(
        new Request("http://localhost/api/chat?stream=1", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({
            message: prompt,
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
        (doneEvent as { toolResults?: ToolResult[] } | undefined)?.toolResults ?? [];
      const names = toolResults.map((r) => r.name);
      e2eLog.toolCall(`pattern ${pattern.patternId}`, names.join(","));

      expect(toolResults.length).toBeGreaterThan(0);
      expect(typeof (doneEvent as { content?: string }).content).toBe("string");

      // Optional: when chat created agent(s)/workflow, assert minimal structure
      await assertPatternStructure(pattern, toolResults);
    }, 120_000);
  }
});

async function assertPatternStructure(
  pattern: PatternExample,
  toolResults: ToolResult[]
): Promise<void> {
  const createAgentResults = toolResults.filter((r) => r.name === "create_agent");
  const createWorkflowResults = toolResults.filter((r) => r.name === "create_workflow");

  for (const r of createAgentResults) {
    const id = r.result?.id;
    if (typeof id !== "string") continue;
    const agent = (await executeTool("get_agent", { id }, undefined)) as {
      graphNodes?: unknown[];
      toolIds?: string[];
    };
    if (agent && !("error" in agent)) {
      expect(Array.isArray(agent.graphNodes)).toBe(true);
      if (pattern.level === "intra" && pattern.patternId === "prompt-chaining") {
        expect((agent.graphNodes?.length ?? 0) >= 2).toBe(true);
      }
      if (pattern.patternId === "sequential-llm-tool-llm") {
        expect((agent.graphNodes?.length ?? 0) >= 3).toBe(true);
      }
    }
  }

  for (const r of createWorkflowResults) {
    const id = r.result?.id;
    if (typeof id !== "string") continue;
    const workflow = (await executeTool("get_workflow", { id }, undefined)) as {
      nodes?: unknown[];
      edges?: unknown[];
    };
    if (workflow && !("error" in workflow)) {
      expect(Array.isArray(workflow.nodes)).toBe(true);
      if (pattern.level === "workflow") {
        expect((workflow.nodes?.length ?? 0) >= 1).toBe(true);
        if (
          pattern.patternId === "role-based-assembly-line" ||
          pattern.patternId === "orchestrator-workers"
        ) {
          expect((workflow.nodes?.length ?? 0) >= 2).toBe(true);
        }
        if (
          pattern.patternId === "evaluator-optimizer" ||
          pattern.patternId === "custom-linear-two-agents"
        ) {
          expect((workflow.nodes?.length ?? 0) >= 2).toBe(true);
          expect(Array.isArray(workflow.edges)).toBe(true);
          expect((workflow.edges?.length ?? 0) >= 1).toBe(true);
        }
      }
    }
  }
}
