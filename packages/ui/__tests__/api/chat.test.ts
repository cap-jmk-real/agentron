import { describe, it, expect, vi } from "vitest";
import { GET, POST as chatPost } from "../../app/api/chat/route";
import { GET as getChatEvents } from "../../app/api/chat/events/route";
import { POST as convPost } from "../../app/api/chat/conversations/route";
import { POST as workflowsPost } from "../../app/api/workflows/route";
import { db, llmConfigs, toLlmConfigRow } from "../../app/api/_lib/db";
import { eq } from "drizzle-orm";
import { processChatStreamEvent } from "../../app/hooks/useChatStream";

const FIXTURE_LLM_ID = "fixture-llm-abort-test";

/** When set, heap test mock returns router then execute_workflow tool call for this workflow id. */
const heapTestWorkflowIdRef = { current: "" };

vi.mock("@agentron-studio/runtime", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    createDefaultLLMManager: () => {
      let chatCallCount = 0;
      return {
        chat: async () => {
          chatCallCount += 1;
          // Call 1 = rephrase, 2 = router, 3 = workflow specialist
          if (heapTestWorkflowIdRef.current && chatCallCount === 2) {
            return {
              content: JSON.stringify({ priorityOrder: ["workflow"], refinedTask: "Run the workflow" }),
              usage: undefined,
            };
          }
          if (heapTestWorkflowIdRef.current && chatCallCount === 3) {
            return {
              content: `<tool_call>{"name":"execute_workflow","arguments":{"workflowId":"${heapTestWorkflowIdRef.current}"}}</tool_call>`,
              usage: undefined,
            };
          }
          await new Promise((r) => setTimeout(r, 300));
          return { content: "Fixture reply from mock LLM", usage: undefined };
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
    expect(res.status).toBe(202);
    const data = await res.json();
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
    expect(secondRes.status).toBe(202);
    const secondData = await secondRes.json();
    expect(typeof secondData.turnId).toBe("string");
  }, 15_000);

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
      expect(res.status).toBe(202);
      const data = await res.json();
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
      const doneEvent = events.find((e) => e?.type === "done");
      expect(doneEvent).toBeDefined();
      expect(Array.isArray(doneEvent?.toolResults)).toBe(true);
      const execWf = (doneEvent!.toolResults as { name: string; result?: { id?: string; status?: string } }[]).find(
        (r) => r.name === "execute_workflow"
      );
      expect(execWf).toBeDefined();
      expect(execWf!.result).toBeDefined();
      expect(typeof (execWf!.result as { id?: string }).id).toBe("string");
      expect(["completed", "waiting_for_user", "running"]).toContain((execWf!.result as { status?: string }).status);
      expect(typeof doneEvent!.content).toBe("string");
      expect((doneEvent!.content as string).length).toBeGreaterThan(0);
    } finally {
      heapTestWorkflowIdRef.current = "";
    }
  }, 20_000);

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
    expect(res.status).toBe(202);
    const data = await res.json();
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
      expect(res.status).toBe(202);
      const data = await res.json();
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
    } finally {
      heapTestWorkflowIdRef.current = "";
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
});
