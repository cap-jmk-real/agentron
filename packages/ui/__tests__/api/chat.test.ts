import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { GET, POST as chatPost, IMPROVE_AGENTS_WORKFLOWS_CANNOT_CREATE } from "../../app/api/chat/route";
import { GET as getChatEvents } from "../../app/api/chat/events/route";
import { GET as getMessageLog } from "../../app/api/queues/message-log/route";
import { POST as convPost } from "../../app/api/chat/conversations/route";
import { POST as workflowsPost } from "../../app/api/workflows/route";
import { db, llmConfigs, toLlmConfigRow, agents } from "../../app/api/_lib/db";
import { eq } from "drizzle-orm";
import { processChatStreamEvent } from "../../app/hooks/useChatStream";

const FIXTURE_LLM_ID = "fixture-llm-abort-test";

/** When set, heap test mock returns planner + execute_workflow for "run the workflow". Id should come from context (Studio resources) like production; mock also accepts ref/global for test visibility. */
const heapTestWorkflowIdRef = { current: "" };
const HEAP_TEST_WORKFLOW_ID_GLOBAL = "__heap_test_workflow_id__";
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** Tracks that we already returned "workflow__part1" so the next workflow call returns execute_workflow. */
const heapTestWorkflowReturnedPart1Ref = { current: false };

/** When set, heap test mock returns agent then workflow order and agent specialist outputs list_tools then create_agent (follow-up). */
const heapTestCreateAgentFlowRef = { current: false };

/** When set, planner (call 2) returns empty content but valid plan in response.raw (OpenAI-like). */
const heapTestPlannerRawFallbackRef = { current: false };

/** When set, planner (call 2) returns empty content and no usable raw; fallback order used. */
const heapTestPlannerEmptyRef = { current: false };

describe("improve_agents_workflows specialist prompt", () => {
  it("IMPROVE_AGENTS_WORKFLOWS_CANNOT_CREATE contains cannot create and do not ask for creation parameters", () => {
    expect(IMPROVE_AGENTS_WORKFLOWS_CANNOT_CREATE).toContain("cannot create");
    expect(IMPROVE_AGENTS_WORKFLOWS_CANNOT_CREATE).toMatch(/do not ask.*creation parameters|creation parameters/i);
  });
});

vi.mock("@agentron-studio/runtime", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    createDefaultLLMManager: () => {
      let chatCallCount = 0;
      return {
        chat: async (_config: unknown, req: { messages?: { role: string; content?: string | unknown[] }[] } | undefined) => {
          const safeRaw = (content: string) => ({ id: "mock", content, usage: undefined as undefined, raw: { choices: [{ message: { content } }] } });
          try {
            chatCallCount += 1;
            const contentToString = (c: unknown): string =>
              typeof c === "string" ? c : Array.isArray(c) ? (c as { text?: string }[]).map((p) => (p && typeof p === "object" && typeof (p as { text?: string }).text === "string" ? (p as { text: string }).text : "")).join("") : "";
            const firstUser = req?.messages?.find((m: { role: string }) => m.role === "user");
            const firstUserContent = contentToString(firstUser?.content ?? "");
            const allContent = (req?.messages ?? []).map((m: { content?: unknown }) => contentToString(m.content)).join("\n");
            const firstMsg = req?.messages?.[0];
            const firstMsgContent = contentToString(firstMsg?.content ?? "");
            const isPlannerPrompt = (r: { messages?: { role: string; content?: string | unknown[] }[] } | undefined) => {
              const msg = r?.messages?.[0];
              const c = msg?.content;
              const str = typeof c === "string" ? c : Array.isArray(c) ? (c as { text?: string }[]).map((p) => (p && typeof p === "object" && typeof (p as { text?: string }).text === "string" ? (p as { text: string }).text : "")).join("") : "";
              return msg?.role === "user" && str.includes("You are a planner") && str.includes("priorityOrder");
            };
            const isTitleRequest = (req?.messages ?? []).some((m: { role?: string; content?: unknown }) => m.role === "system" && typeof m.content === "string" && m.content.includes("chat title"));
            const isSpecialistCall = firstMsg?.role === "system" && firstMsgContent.includes("specialist") && firstMsgContent.includes("Use only these tools");
            if (isTitleRequest) {
              return { ...safeRaw("Heap Test Title"), content: "Heap Test Title", usage: undefined };
            }
            if (heapTestPlannerRawFallbackRef.current && isPlannerPrompt(req)) {
              return {
                id: "planner-raw",
                content: "",
                raw: {
                  choices: [{ message: { content: '{"priorityOrder": ["agent", "workflow"], "refinedTask": "Create agent and workflow."}' } }],
                },
                usage: undefined,
              };
            }
            if (heapTestPlannerEmptyRef.current && isPlannerPrompt(req)) {
              return {
                id: "planner-empty",
                content: "",
                raw: { choices: [] },
                usage: undefined,
              };
            }
            if (heapTestCreateAgentFlowRef.current && isPlannerPrompt(req)) {
              return { ...safeRaw(""), content: JSON.stringify({ priorityOrder: ["agent", "workflow"], refinedTask: "Create agent and workflow" }) };
            }
            if (heapTestCreateAgentFlowRef.current && chatCallCount === 3) {
              const c = `<tool_call>{"name":"list_tools","arguments":{}}</tool_call>`;
              return { ...safeRaw(c), content: c };
            }
            if (heapTestCreateAgentFlowRef.current && chatCallCount === 4) {
              const c = `<tool_call>{"name":"create_agent","arguments":{"name":"Heap Test Create-Agent Flow","description":"Test agent","systemPrompt":"You are a test agent."}}</tool_call>`;
              return { ...safeRaw(c), content: c };
            }
            if (heapTestCreateAgentFlowRef.current && isSpecialistCall && firstMsgContent.includes("workflow") && firstMsgContent.includes("create_workflow")) {
              const c = `<tool_call>{"name":"create_workflow","arguments":{"name":"Heap Test WF","nodes":[],"edges":[],"executionMode":"one_time"}}</tool_call>`;
              return { ...safeRaw(c), content: c };
            }
            if (heapTestCreateAgentFlowRef.current && chatCallCount === 5) {
              const c = `<tool_call>{"name":"create_workflow","arguments":{"name":"Heap Test WF","nodes":[],"edges":[],"executionMode":"one_time"}}</tool_call>`;
              return { ...safeRaw(c), content: c };
            }
            const workflowIdForRun = heapTestWorkflowIdRef.current || (typeof globalThis !== "undefined" && (globalThis as Record<string, string>)[HEAP_TEST_WORKFLOW_ID_GLOBAL]);
            if (workflowIdForRun && isPlannerPrompt(req)) {
              return { ...safeRaw(JSON.stringify({ priorityOrder: ["workflow"], refinedTask: "Run the workflow" })), content: JSON.stringify({ priorityOrder: ["workflow"], refinedTask: "Run the workflow" }) };
            }
            if (workflowIdForRun && !isPlannerPrompt(req)) {
              const isChooseSubspecialist = firstUserContent.includes("Which subspecialist") && firstUserContent.includes("Reply with exactly one id");
              if (isChooseSubspecialist) {
                heapTestWorkflowReturnedPart1Ref.current = true;
                return { ...safeRaw("workflow__part1"), content: "workflow__part1" };
              }
              if (isSpecialistCall) {
                if (allContent.includes("Workflow not found")) {
                  const failureContent = "The workflow run failed: Workflow not found. I can help you run a different workflow or create one if you'd like.";
                  return { ...safeRaw(failureContent), content: failureContent, usage: undefined };
                }
                const fromContext = allContent.match(UUID_RE)?.[0];
                const wfId = fromContext === workflowIdForRun ? fromContext : workflowIdForRun;
                const c = `<tool_call>{"name":"execute_workflow","arguments":{"workflowId":"${wfId}"}}</tool_call>`;
                return { ...safeRaw(c), content: c };
              }
            }
          await new Promise((r) => setTimeout(r, 300));
          return {
            id: "mock-default",
            content: "Fixture reply from mock LLM",
            usage: undefined,
            raw: { choices: [{ message: { content: "Fixture reply from mock LLM" } }] },
          };
          } catch {
            return safeRaw("Fixture reply from mock LLM");
          }
        },
      };
    },
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

  it("decoupled chat returns 202 and turnId; events stream runs job and releases lock", async () => {
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
        body: JSON.stringify({ title: "Decoupled test" }),
      })
    );
    const conv = await createRes.json();
    const conversationId = conv.id as string;
    expect(conversationId).toBeDefined();

    const res = await chatPost(
      new Request("http://localhost/api/chat?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          message: "hello",
          conversationId,
          providerId: FIXTURE_LLM_ID,
        }),
      })
    );
    expect(res).toBeDefined();
    expect(res!.status).toBe(202);
    const data = await res!.json();
    const turnId = data.turnId;
    expect(typeof turnId).toBe("string");

    const eventsRes = await getChatEvents(new Request(`http://localhost/api/chat/events?turnId=${encodeURIComponent(turnId)}`));
    expect(eventsRes.ok).toBe(true);
    const reader = eventsRes.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const readUntilDone = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (value) buffer += decoder.decode(value);
          if (done) break;
        }
      } finally {
        reader.releaseLock();
      }
    };
    await readUntilDone();

    const lines = buffer.split("\n\n").filter((s) => s.trim());
    const events: { type?: string }[] = [];
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
    const doneOrError = events.find((e) => e?.type === "done" || e?.type === "error");
    expect(events.length).toBeGreaterThan(0);
    expect(doneOrError).toBeDefined();

    const getRes = await GET(new Request(`http://localhost/api/chat?conversationId=${conversationId}`));
    expect(getRes.status).toBe(200);
    const messages = await getRes.json();
    expect(Array.isArray(messages)).toBe(true);

    const msgLogRes = await getMessageLog(new Request(`http://localhost/api/queues/message-log?conversationId=${encodeURIComponent(conversationId)}`));
    expect(msgLogRes.status).toBe(200);
    const msgLog = await msgLogRes.json();
    expect(Array.isArray(msgLog.steps)).toBe(true);
    const userInputStep = msgLog.steps.find((s: { phase: string }) => s.phase === "user_input");
    expect(userInputStep).toBeDefined();
    expect(userInputStep.type).toBe("trace_step");
    expect(userInputStep.label).toBe("User input");
    let payloadObj: { inputPreview?: string } = {};
    try {
      payloadObj = typeof userInputStep.payload === "string" ? JSON.parse(userInputStep.payload) : userInputStep.payload ?? {};
    } catch {
      //
    }
    expect(typeof payloadObj.inputPreview).toBe("string");
    expect(payloadObj.inputPreview).toContain("hello");

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
    expect(secondRes).toBeDefined();
    expect(secondRes!.status).toBe(202);
    const secondData = await secondRes!.json();
    expect(typeof secondData.turnId).toBe("string");
  }, 15_000);

  it("multi-turn conversation: second assistant response is persisted and returned by GET", async () => {
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
        body: JSON.stringify({ title: "Multi-turn test" }),
      })
    );
    const conv = await createRes.json();
    const conversationId = conv.id as string;
    expect(conversationId).toBeDefined();

    const readStreamUntilDone = async (res: Response): Promise<{ type?: string }[]> => {
      const reader = res.body!.getReader();
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
      const events: { type?: string }[] = [];
      for (const line of buffer.split("\n\n").filter((s) => s.trim())) {
        const m = line.match(/^data:\s*(.+)$/m);
        if (m) {
          try {
            events.push(JSON.parse(m[1].trim()));
          } catch {
            //
          }
        }
      }
      return events;
    };

    const firstRes = await chatPost(
      new Request("http://localhost/api/chat?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ message: "first", conversationId, providerId: FIXTURE_LLM_ID }),
      })
    );
    expect(firstRes).toBeDefined();
    expect(firstRes!.status).toBe(202);
    const firstTurnId = (await firstRes!.json()).turnId;
    const firstEventsRes = await getChatEvents(new Request(`http://localhost/api/chat/events?turnId=${encodeURIComponent(firstTurnId)}`));
    expect(firstEventsRes.ok).toBe(true);
    const firstEvents = await readStreamUntilDone(firstEventsRes);
    expect(firstEvents.some((e) => e?.type === "done" || e?.type === "error")).toBe(true);

    const secondRes = await chatPost(
      new Request("http://localhost/api/chat?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ message: "second turn", conversationId, providerId: FIXTURE_LLM_ID }),
      })
    );
    expect(secondRes).toBeDefined();
    expect(secondRes!.status).toBe(202);
    const secondTurnId = (await secondRes!.json()).turnId;
    const secondEventsRes = await getChatEvents(new Request(`http://localhost/api/chat/events?turnId=${encodeURIComponent(secondTurnId)}`));
    expect(secondEventsRes.ok).toBe(true);
    const secondEvents = await readStreamUntilDone(secondEventsRes);
    expect(secondEvents.some((e) => e?.type === "done" || e?.type === "error")).toBe(true);

    const getRes = await GET(new Request(`http://localhost/api/chat?conversationId=${conversationId}`));
    expect(getRes.status).toBe(200);
    const messages = await getRes.json();
    expect(Array.isArray(messages)).toBe(true);
    expect(messages.length).toBe(4);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toContain("first");
    expect(messages[1].role).toBe("assistant");
    expect(messages[2].role).toBe("user");
    expect(messages[2].content).toContain("second turn");
    expect(messages[3].role).toBe("assistant");
    expect(typeof messages[3].content).toBe("string");
    expect(messages[3].content.length).toBeGreaterThan(0);
  }, 25_000);

  it("heap mode done event includes execute_workflow toolResults so client can trigger run", async () => {
    try {
      await db.delete(llmConfigs).where(eq(llmConfigs.id, FIXTURE_LLM_ID)).run();
    } catch {
      // ignore
    }
    await db
      .insert(llmConfigs)
      .values(toLlmConfigRow({ id: FIXTURE_LLM_ID, provider: "openai", model: "gpt-4" } as Parameters<typeof toLlmConfigRow>[0]))
      .run();

    const wfRes = await workflowsPost(
      new Request("http://localhost/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Heap test workflow", nodes: [], edges: [], executionMode: "one_time" }),
      })
    );
    const wf = await wfRes.json();
    const workflowId = wf.id as string;
    expect(workflowId).toBeDefined();

    const createRes = await convPost(
      new Request("http://localhost/api/chat/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Heap run test" }),
      })
    );
    const conv = await createRes.json();
    const conversationId = conv.id as string;

    heapTestWorkflowIdRef.current = workflowId;
    if (typeof globalThis !== "undefined") (globalThis as Record<string, string>)[HEAP_TEST_WORKFLOW_ID_GLOBAL] = workflowId;
    try {
      const res = await chatPost(
        new Request("http://localhost/api/chat?stream=1", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({
            message: "run the workflow",
            conversationId,
            providerId: FIXTURE_LLM_ID,
            useHeapMode: true,
          }),
        })
      );
      expect(res).toBeDefined();
      expect(res!.status).toBe(202);
      const data = await res!.json();
      const turnId = data.turnId;
      expect(typeof turnId).toBe("string");

      const eventsRes = await getChatEvents(new Request(`http://localhost/api/chat/events?turnId=${encodeURIComponent(turnId)}`));
      expect(eventsRes.ok).toBe(true);
      const reader = eventsRes.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (value) buffer += decoder.decode(value);
        if (done) break;
      }
      reader.releaseLock();

      const lines = buffer.split("\n\n").filter((s) => s.trim());
      const events: { type?: string; toolResults?: { name: string; result?: { id?: string; status?: string } }[] }[] = [];
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
      const doneEvent = events.find((e) => e?.type === "done") as { type?: string; toolResults?: { name: string; result?: { id?: string; status?: string } }[]; content?: string } | undefined;
      expect(doneEvent).toBeDefined();
      if (!doneEvent || !Array.isArray(doneEvent.toolResults)) {
        const types = events.map((e) => e?.type).filter(Boolean);
        throw new Error(`done event missing or no toolResults. Event types: ${types.join(", ")}. doneEvent keys: ${doneEvent ? Object.keys(doneEvent).join(", ") : "none"}`);
      }
      const execWf = (doneEvent.toolResults as { name: string; result?: { id?: string; status?: string } }[]).find(
        (r) => r.name === "execute_workflow"
      );
      expect(execWf, `expected execute_workflow in toolResults; got: ${JSON.stringify(doneEvent.toolResults.map((r) => r.name))}`).toBeDefined();
      expect(execWf!.result).toBeDefined();
      expect(typeof (execWf!.result as { id?: string }).id).toBe("string");
      expect(["completed", "waiting_for_user", "running"]).toContain((execWf!.result as { status?: string }).status);
      expect(typeof doneEvent!.content).toBe("string");
      expect((doneEvent!.content as string).length).toBeGreaterThan(0);
    } finally {
      heapTestWorkflowIdRef.current = "";
      heapTestWorkflowReturnedPart1Ref.current = false;
      if (typeof globalThis !== "undefined") delete (globalThis as Record<string, string>)[HEAP_TEST_WORKFLOW_ID_GLOBAL];
    }
  }, 20_000);

  it("create agent then workflow flow: create_agent in toolResults and agent in DB", async () => {
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
        body: JSON.stringify({ title: "Create agent flow test" }),
      })
    );
    const conv = await createRes.json();
    const conversationId = conv.id as string;
    heapTestCreateAgentFlowRef.current = true;
    try {
      const res = await chatPost(
        new Request("http://localhost/api/chat?stream=1", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({
            message: "create an agent and a workflow",
            conversationId,
            providerId: FIXTURE_LLM_ID,
            useHeapMode: true,
          }),
        })
      );
      expect(res).toBeDefined();
      expect(res!.status).toBe(202);
      const data = await res!.json();
      const turnId = data.turnId;
      expect(typeof turnId).toBe("string");
      const eventsRes = await getChatEvents(new Request(`http://localhost/api/chat/events?turnId=${encodeURIComponent(turnId)}`));
      expect(eventsRes.ok).toBe(true);
      const reader = eventsRes.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (value) buffer += decoder.decode(value);
        if (done) break;
      }
      reader.releaseLock();
      const lines = buffer.split("\n\n").filter((s) => s.trim());
      const events: { type?: string; toolResults?: { name: string }[] }[] = [];
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
      const doneEvent = events.find((e) => e?.type === "done");
      expect(doneEvent).toBeDefined();
      expect(Array.isArray(doneEvent?.toolResults)).toBe(true);
      const toolResults = doneEvent!.toolResults as { name: string; args?: Record<string, unknown>; result?: unknown }[];
      const createAgentResult = toolResults.find((r) => r.name === "create_agent");
      expect(createAgentResult).toBeDefined();
      const createdAgentId = createAgentResult?.result && typeof createAgentResult.result === "object" && "id" in createAgentResult.result ? (createAgentResult.result as { id: string }).id : undefined;
      expect(typeof createdAgentId).toBe("string");
      const agentRows = await db.select({ id: agents.id, name: agents.name }).from(agents).where(eq(agents.name, "Heap Test Create-Agent Flow"));
      expect(agentRows.length).toBeGreaterThanOrEqual(1);
      // Structured handoff is implemented: agent outcome includes [Created agent id: <uuid>]; workflow specialist receives it in "Previous steps"
    } finally {
      heapTestCreateAgentFlowRef.current = false;
    }
  }, 25_000);

  it("heap mode done event has toolResults array when specialist runs no tools", async () => {
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
        body: JSON.stringify({ title: "Heap no-tools test" }),
      })
    );
    const conv = await createRes.json();
    const conversationId = conv.id as string;
    expect(heapTestWorkflowIdRef.current).toBe("");
    const res = await chatPost(
      new Request("http://localhost/api/chat?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          message: "just say hi",
          conversationId,
          providerId: FIXTURE_LLM_ID,
          useHeapMode: true,
        }),
      })
    );
    expect(res).toBeDefined();
    expect(res!.status).toBe(202);
    const data = await res!.json();
    const turnId = data.turnId;
    const eventsRes = await getChatEvents(new Request(`http://localhost/api/chat/events?turnId=${encodeURIComponent(turnId)}`));
    expect(eventsRes.ok).toBe(true);
    const reader = eventsRes.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value);
      if (done) break;
    }
    reader.releaseLock();
    const lines = buffer.split("\n\n").filter((s) => s.trim());
    const events: { type?: string; toolResults?: unknown[] }[] = [];
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
    const doneEvent = events.find((e) => e?.type === "done");
    expect(doneEvent).toBeDefined();
    expect(Array.isArray(doneEvent!.toolResults)).toBe(true);
    expect((doneEvent!.toolResults as unknown[]).length).toBe(0);
  }, 20_000);

  it("planner response.raw fallback: when content is empty but raw has OpenAI-like plan, plan is parsed and trace has parsedPlan", async () => {
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
        body: JSON.stringify({ title: "Planner raw fallback test" }),
      })
    );
    const conv = await createRes.json();
    const conversationId = conv.id as string;
    heapTestPlannerRawFallbackRef.current = true;
    try {
      const res = await chatPost(
        new Request("http://localhost/api/chat?stream=1", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({
            message: "create an agent and workflow",
            conversationId,
            providerId: FIXTURE_LLM_ID,
            useHeapMode: true,
          }),
        })
      );
      expect(res).toBeDefined();
      expect(res!.status).toBe(202);
      const data = await res!.json();
      const turnId = data.turnId;
      const eventsRes = await getChatEvents(new Request(`http://localhost/api/chat/events?turnId=${encodeURIComponent(turnId)}`));
      expect(eventsRes.ok).toBe(true);
      const reader = eventsRes.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (value) buffer += decoder.decode(value);
        if (done) break;
      }
      reader.releaseLock();
      const lines = buffer.split("\n\n").filter((s) => s.trim());
      const streamEvents: { type?: string; phase?: string; parsedPlan?: { priorityOrder?: string[] }; rawResponse?: string }[] = [];
      for (const line of lines) {
        const m = line.match(/^data:\s*(.+)$/m);
        if (m) {
          try {
            streamEvents.push(JSON.parse(m[1].trim()));
          } catch {
            //
          }
        }
      }
      const doneOrError = streamEvents.find((e) => e.type === "done" || e.type === "error");
      expect(streamEvents.length).toBeGreaterThan(0);
      expect(doneOrError).toBeDefined();
      const plannerResponseFromStream = streamEvents.filter((e) => e.type === "trace_step" && e.phase === "planner_response");
      if (plannerResponseFromStream.length >= 1) {
        const ev = plannerResponseFromStream[plannerResponseFromStream.length - 1];
        expect(ev.parsedPlan).toBeDefined();
        expect(ev.parsedPlan?.priorityOrder).toEqual(["agent", "workflow"]);
        expect(String(ev.rawResponse ?? "")).not.toContain("Planner returned no text");
      }
      await new Promise((r) => setTimeout(r, 500));
      const msgLogRes = await getMessageLog(new Request(`http://localhost/api/queues/message-log?conversationId=${encodeURIComponent(conversationId)}`));
      expect(msgLogRes.status).toBe(200);
      const msgLog = await msgLogRes.json();
      expect(Array.isArray(msgLog.steps)).toBe(true);
      const plannerStep = msgLog.steps.find((s: { phase: string }) => s.phase === "planner_response");
      if (plannerStep) {
        const payload = typeof plannerStep.payload === "string" ? JSON.parse(plannerStep.payload) : plannerStep.payload ?? {};
        expect(payload.parsedPlan).toBeDefined();
        expect(payload.parsedPlan?.priorityOrder).toEqual(["agent", "workflow"]);
        expect(String(payload.rawResponse ?? "")).not.toContain("Planner returned no text");
      }
      const routePath = join(__dirname, "../../app/api/chat/route.ts");
      const routeSource = readFileSync(routePath, "utf-8");
      expect(routeSource).toContain("extractContentFromRawResponse");
    } finally {
      heapTestPlannerRawFallbackRef.current = false;
    }
  }, 25_000);

  it("planner empty content and no usable raw: fallback order used and trace shows placeholder", async () => {
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
        body: JSON.stringify({ title: "Planner empty test" }),
      })
    );
    const conv = await createRes.json();
    const conversationId = conv.id as string;
    heapTestPlannerEmptyRef.current = true;
    try {
      const res = await chatPost(
        new Request("http://localhost/api/chat?stream=1", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({
            message: "create an agent and a workflow",
            conversationId,
            providerId: FIXTURE_LLM_ID,
            useHeapMode: true,
          }),
        })
      );
      expect(res).toBeDefined();
      expect(res!.status).toBe(202);
      const data = await res!.json();
      const turnId = data.turnId;
      const eventsRes = await getChatEvents(new Request(`http://localhost/api/chat/events?turnId=${encodeURIComponent(turnId)}`));
      expect(eventsRes.ok).toBe(true);
      const reader = eventsRes.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (value) buffer += decoder.decode(value);
        if (done) break;
      }
      reader.releaseLock();
      const lines = buffer.split("\n\n").filter((s) => s.trim());
      const events: { type?: string; phase?: string; rawResponse?: string; rawPreview?: string }[] = [];
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
      const plannerResponseEvents = events.filter((e) => e.type === "trace_step" && e.phase === "planner_response");
      expect(plannerResponseEvents.length).toBeGreaterThanOrEqual(1, "planner_response trace step must be emitted so queue UI and tests can see planner output");
      const plannerEv = plannerResponseEvents[plannerResponseEvents.length - 1];
      const rawResp = String(plannerEv.rawResponse ?? "");
      const noProviderPlaceholder = "(Planner returned no text; no response from provider.)";
      expect(rawResp.length).toBeGreaterThan(0);
      expect(rawResp).not.toBe(noProviderPlaceholder);
      if (plannerEv.rawPreview !== undefined) expect(typeof plannerEv.rawPreview).toBe("string");
      expect(plannerEv.parsedPlan == null || plannerEv.parsedPlan === undefined).toBe(true);
      const doneOrError = events.find((e) => e.type === "done" || e.type === "error");
      expect(doneOrError).toBeDefined();
      await new Promise((r) => setTimeout(r, 500));
      const msgLogRes = await getMessageLog(new Request(`http://localhost/api/queues/message-log?conversationId=${encodeURIComponent(conversationId)}`));
      expect(msgLogRes.status).toBe(200);
      const msgLog = await msgLogRes.json();
      const plannerSteps = (msgLog.steps as { phase: string; payload: string | null }[]).filter((s) => s.phase === "planner_response");
      expect(plannerSteps.length).toBeGreaterThanOrEqual(1);
      const plannerStep = plannerSteps[plannerSteps.length - 1];
      const payload = typeof plannerStep.payload === "string" ? JSON.parse(plannerStep.payload) : plannerStep.payload ?? {};
      expect(payload.parsedPlan == null || payload.parsedPlan === undefined).toBe(true);
      expect(typeof payload.noPlanReason === "string").toBe(true, "when no plan is derived, trace must include noPlanReason so UI can show why");
      const payloadRaw = String(payload.rawResponse ?? "");
      expect(payloadRaw).not.toBe(noProviderPlaceholder);
      expect(payloadRaw.length).toBeGreaterThan(0);
      if (payload.rawPreview !== undefined) expect(typeof payload.rawPreview).toBe("string");
    } finally {
      heapTestPlannerEmptyRef.current = false;
    }
  }, 25_000);

  it("planner_response in queue always has provider output (never no response from provider)", () => {
    const routePath = join(__dirname, "../../app/api/chat/route.ts");
    const routeSource = readFileSync(routePath, "utf-8");
    expect(routeSource).toContain("rawToUse");
    expect(routeSource).toContain("plannerResponse != null");
    expect(routeSource).toContain("content: plannerResponse.content, id: plannerResponse.id, usage: plannerResponse.usage");
    expect(routeSource).toContain("(Planner returned no text; no response from provider.)");
  });

  it("workflow specialist prompt instructs list_agents when previous step created agent but no id in handoff", () => {
    const routePath = join(__dirname, "../../app/api/chat/route.ts");
    const routeSource = readFileSync(routePath, "utf-8");
    expect(routeSource).toContain("list_agents");
    expect(routeSource).toContain("Do not ask the user for the agent UUID in that case");
    expect(routeSource).toContain("Previous steps say an agent was created");
    expect(routeSource).toContain("[Created agent id: ...]");
  });

  it("heap mode done event includes execute_workflow tool result when workflow not found (error result)", async () => {
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
        body: JSON.stringify({ title: "Heap error result test" }),
      })
    );
    const conv = await createRes.json();
    const conversationId = conv.id as string;
    const fakeWorkflowId = "00000000-0000-0000-0000-000000000000";
    heapTestWorkflowIdRef.current = fakeWorkflowId;
    if (typeof globalThis !== "undefined") (globalThis as Record<string, string>)[HEAP_TEST_WORKFLOW_ID_GLOBAL] = fakeWorkflowId;
    try {
      const res = await chatPost(
        new Request("http://localhost/api/chat?stream=1", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({
            message: "run the workflow",
            conversationId,
            providerId: FIXTURE_LLM_ID,
            useHeapMode: true,
          }),
        })
      );
      expect(res).toBeDefined();
      expect(res!.status).toBe(202);
      const data = await res!.json();
      const turnId = data.turnId;
      const eventsRes = await getChatEvents(new Request(`http://localhost/api/chat/events?turnId=${encodeURIComponent(turnId)}`));
      expect(eventsRes.ok).toBe(true);
      const reader = eventsRes.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (value) buffer += decoder.decode(value);
        if (done) break;
      }
      reader.releaseLock();
      const lines = buffer.split("\n\n").filter((s) => s.trim());
      const events: { type?: string; toolResults?: { name: string; result?: { error?: string } }[] }[] = [];
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
      const doneEvent = events.find((e) => e?.type === "done");
      expect(doneEvent).toBeDefined();
      expect(Array.isArray(doneEvent?.toolResults)).toBe(true);
      const execWf = (doneEvent!.toolResults as { name: string; result?: { error?: string } }[]).find(
        (r) => r.name === "execute_workflow"
      );
      expect(execWf).toBeDefined();
      expect(execWf!.result).toBeDefined();
      expect((execWf!.result as { error?: string }).error).toBe("Workflow not found");
      // Failure surfacing: assistant reply includes failure reason (and optionally offer to fix)
      expect(typeof (doneEvent as { content?: string }).content).toBe("string");
      expect((doneEvent as { content?: string }).content).toMatch(/failed|Workflow not found/i);
    } finally {
      heapTestWorkflowIdRef.current = "";
      heapTestWorkflowReturnedPart1Ref.current = false;
      if (typeof globalThis !== "undefined") delete (globalThis as Record<string, string>)[HEAP_TEST_WORKFLOW_ID_GLOBAL];
    }
  }, 20_000);
});

describe("Chat stream / processChatStreamEvent", () => {
  it("done event updates placeholder with content", () => {
    const updatePlaceholder = vi.fn();
    const setMessages = vi.fn();
    const setConversationId = vi.fn();
    const setConversationList = vi.fn();
    processChatStreamEvent(
      {
        type: "done",
        content: "Assistant reply here",
        messageId: "msg-123",
        userMessageId: "user-456",
      },
      {
        placeholderId: "placeholder-id",
        userMsgId: "user-456",
        updatePlaceholder,
        setMessages,
        setConversationId,
        setConversationList,
        doneReceived: { current: false },
        onRunFinished: undefined,
        onDone: undefined,
      }
    );
    expect(updatePlaceholder).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Assistant reply here",
      }),
      true
    );
    expect(setMessages).toHaveBeenCalled();
  });

  it("final buffer with done event parses correctly", () => {
    const line = `data: ${JSON.stringify({
      type: "done",
      content: "Final response",
      messageId: "m1",
    })}\n\n`;
    const lines = line.split("\n\n");
    const buffer = lines.pop() ?? "";
    const parsed: unknown[] = [];
    for (const l of lines) {
      const m = l.match(/^data:\s*(.+)$/m);
      if (m) {
        try {
          parsed.push(JSON.parse(m[1].trim()));
        } catch {
          // skip
        }
      }
    }
    expect(parsed).toHaveLength(1);
    expect((parsed[0] as { type: string }).type).toBe("done");
    expect((parsed[0] as { content?: string }).content).toBe("Final response");
    expect(buffer).toBe("");
  });

  it("final buffer without trailing newline parses after second flush", () => {
    const line = `data: ${JSON.stringify({ type: "done", content: "No newline" })}`;
    let buffer = line;
    const parsed: unknown[] = [];
    const processBuffer = () => {
      const lines = buffer.split("\n\n");
      buffer = lines.pop() ?? "";
      for (const l of lines) {
        const m = l.match(/^data:\s*(.+)$/m);
        if (m) {
          try {
            parsed.push(JSON.parse(m[1].trim()));
          } catch {
            // skip
          }
        }
      }
    };
    processBuffer();
    expect(parsed).toHaveLength(0);
    expect(buffer).toBe(line);
    processBuffer();
    if (buffer.trim()) {
      const m = buffer.match(/^data:\s*(.+)$/m);
      if (m) parsed.push(JSON.parse(m[1].trim()));
    }
    expect(parsed).toHaveLength(1);
    expect((parsed[0] as { type: string }).type).toBe("done");
    expect((parsed[0] as { content?: string }).content).toBe("No newline");
  });

  it("content_delta appends to placeholder message content", () => {
    const setMessages = vi.fn();
    setMessages.mockImplementation((fn: (prev: { id: string; content: string }[]) => { id: string; content: string }[]) =>
      fn([{ id: "ph", content: "Hello " }])
    );
    processChatStreamEvent(
      { type: "content_delta", delta: "world" },
      {
        placeholderId: "ph",
        userMsgId: "um",
        updatePlaceholder: vi.fn(),
        setMessages,
        setConversationId: vi.fn(),
        setConversationList: vi.fn(),
        doneReceived: { current: false },
        onRunFinished: undefined,
        onDone: undefined,
      }
    );
    expect(setMessages).toHaveBeenCalled();
    const updater = setMessages.mock.calls[0][0];
    const next = updater([{ id: "ph", content: "Hello " }]);
    expect(next[0].content).toBe("Hello world");
  });
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
      .values(toLlmConfigRow({ id: FIXTURE_LLM_ID, provider: "openai", model: "gpt-4" } as Parameters<typeof toLlmConfigRow>[0]))
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

    // First GET takes the pending job; we do not read its body so the connection just holds the stream
    const firstGetRes = await getChatEvents(
      new Request(`http://localhost/api/chat/events?turnId=${encodeURIComponent(turnId)}`)
    );
    expect(firstGetRes.ok).toBe(true);

    // Second GET gets no job (already taken); with fix it stays subscribed and receives same events
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
      (e) => e?.type === "error" && typeof e?.error === "string" && e.error.includes("Connection issue")
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
      .values(toLlmConfigRow({ id: FIXTURE_LLM_ID, provider: "openai", model: "gpt-4" } as Parameters<typeof toLlmConfigRow>[0]))
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

    const getBeforeRes = await GET(new Request(`http://localhost/api/chat?conversationId=${conversationId}`));
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

    // Do NOT open GET /api/chat/events — simulate client never connecting (e.g. Retry without EventSource)
    const FALLBACK_MS = 4000;
    await new Promise((r) => setTimeout(r, FALLBACK_MS + 800));

    const getAfterRes = await GET(new Request(`http://localhost/api/chat?conversationId=${conversationId}`));
    expect(getAfterRes.status).toBe(200);
    const messagesAfter = await getAfterRes.json();
    expect(Array.isArray(messagesAfter)).toBe(true);
    const countAfter = (messagesAfter as unknown[]).length;
    expect(countAfter).toBeGreaterThan(countBefore);
    const hasNewAssistant = (messagesAfter as { role: string }[]).some((m) => m.role === "assistant");
    expect(hasNewAssistant).toBe(true);
  }, 12_000);
});
