import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { GET } from "../../app/api/queues/route";
import { GET as getMessageLog } from "../../app/api/queues/message-log/route";
import { db, conversationLocks, chatMessages, messageQueueLog } from "../../app/api/_lib/db";

describe("Queues API", () => {
  it("GET /api/queues returns workflowQueue and conversationLocks", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("workflowQueue");
    expect(data.workflowQueue).toHaveProperty("status");
    expect(data.workflowQueue.status).toEqual(
      expect.objectContaining({
        queued: expect.any(Number),
        running: expect.any(Number),
        concurrency: expect.any(Number),
      })
    );
    expect(data.workflowQueue).toHaveProperty("jobs");
    expect(Array.isArray(data.workflowQueue.jobs)).toBe(true);
    expect(data).toHaveProperty("conversationLocks");
    expect(Array.isArray(data.conversationLocks)).toBe(true);
  });

  it("GET /api/queues returns inserted conversation locks", async () => {
    const convId = "queues-test-lock-" + Date.now();
    const now = Date.now();
    await db
      .insert(conversationLocks)
      .values({ conversationId: convId, startedAt: now, createdAt: now })
      .run();
    try {
      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      const found = data.conversationLocks.find(
        (l: { conversationId: string }) => l.conversationId === convId
      );
      expect(found).toBeDefined();
      expect(found.startedAt).toBe(now);
      expect(found.createdAt).toBe(now);
    } finally {
      await db.delete(conversationLocks).where(eq(conversationLocks.conversationId, convId)).run();
    }
  });

  it("GET /api/queues returns activeChatTraces for locked conversations with assistant trace data", async () => {
    const convId = "queues-test-trace-" + Date.now();
    const now = Date.now();
    await db
      .insert(conversationLocks)
      .values({ conversationId: convId, startedAt: now, createdAt: now })
      .run();
    const msgId = "msg-trace-" + Date.now();
    await db
      .insert(chatMessages)
      .values({
        id: msgId,
        conversationId: convId,
        role: "assistant",
        content: "Done.",
        toolCalls: JSON.stringify([{ name: "get_run", arguments: {}, result: { id: "r1" } }]),
        llmTrace: JSON.stringify([
          { phase: "llm_response", messageCount: 3, responsePreview: "Here is the run." },
        ]),
        createdAt: now - 100,
      })
      .run();
    try {
      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty("activeChatTraces");
      expect(Array.isArray(data.activeChatTraces)).toBe(true);
      const trace = data.activeChatTraces.find(
        (t: { conversationId: string }) => t.conversationId === convId
      );
      expect(trace).toBeDefined();
      expect(trace.messageId).toBe(msgId);
      expect(trace.createdAt).toBe(now - 100);
      expect(Array.isArray(trace.toolCalls)).toBe(true);
      expect(trace.toolCalls).toHaveLength(1);
      expect(trace.toolCalls[0].name).toBe("get_run");
      expect(Array.isArray(trace.llmTrace)).toBe(true);
      expect(trace.llmTrace).toHaveLength(1);
      expect(trace.llmTrace[0].phase).toBe("llm_response");
    } finally {
      await db.delete(chatMessages).where(eq(chatMessages.id, msgId)).run();
      await db.delete(conversationLocks).where(eq(conversationLocks.conversationId, convId)).run();
    }
  });

  it("GET /api/queues returns activeChatTraces with empty toolCalls/llmTrace when stored value is not array", async () => {
    const convId = "queues-test-trace-invalid-" + Date.now();
    const now = Date.now();
    await db
      .insert(conversationLocks)
      .values({ conversationId: convId, startedAt: now, createdAt: now })
      .run();
    const msgId = "msg-invalid-" + Date.now();
    await db
      .insert(chatMessages)
      .values({
        id: msgId,
        conversationId: convId,
        role: "assistant",
        content: "Done.",
        toolCalls: "null",
        llmTrace: "{}",
        createdAt: now - 100,
      })
      .run();
    try {
      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      const trace = data.activeChatTraces.find(
        (t: { conversationId: string }) => t.conversationId === convId
      );
      expect(trace).toBeDefined();
      expect(trace.toolCalls).toEqual([]);
      expect(trace.llmTrace).toEqual([]);
    } finally {
      await db.delete(chatMessages).where(eq(chatMessages.id, msgId)).run();
      await db.delete(conversationLocks).where(eq(conversationLocks.conversationId, convId)).run();
    }
  });

  it("GET /api/queues returns messageQueueLog steps for locked conversations", async () => {
    const convId = "queues-test-mqlog-" + Date.now();
    const now = Date.now();
    await db
      .insert(conversationLocks)
      .values({ conversationId: convId, startedAt: now, createdAt: now })
      .run();
    const id1 = "mqlog-1-" + Date.now();
    const id2 = "mqlog-2-" + Date.now();
    await db
      .insert(messageQueueLog)
      .values({
        id: id1,
        conversationId: convId,
        messageId: null,
        type: "trace_step",
        phase: "prepare",
        label: "Preparing context…",
        payload: null,
        createdAt: now - 200,
      })
      .run();
    await db
      .insert(messageQueueLog)
      .values({
        id: id2,
        conversationId: convId,
        messageId: null,
        type: "trace_step",
        phase: "rephrase",
        label: "Rephrasing…",
        payload: null,
        createdAt: now - 100,
      })
      .run();
    try {
      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty("messageQueueLog");
      expect(Array.isArray(data.messageQueueLog)).toBe(true);
      const entry = data.messageQueueLog.find(
        (e: { conversationId: string }) => e.conversationId === convId
      );
      expect(entry).toBeDefined();
      expect(entry.steps).toHaveLength(2);
      expect(entry.steps[0].id).toBe(id1);
      expect(entry.steps[0].type).toBe("trace_step");
      expect(entry.steps[0].phase).toBe("prepare");
      expect(entry.steps[0].label).toBe("Preparing context…");
      expect(entry.steps[1].id).toBe(id2);
      expect(entry.steps[1].label).toBe("Rephrasing…");
    } finally {
      await db.delete(messageQueueLog).where(eq(messageQueueLog.conversationId, convId)).run();
      await db.delete(conversationLocks).where(eq(conversationLocks.conversationId, convId)).run();
    }
  });
});

describe("Queues message-log API", () => {
  it("GET /api/queues/message-log without conversationId returns conversations list and nextOffset", async () => {
    const res = await getMessageLog(new Request("http://localhost/api/queues/message-log"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("conversations");
    expect(Array.isArray(data.conversations)).toBe(true);
    expect(data).toHaveProperty("nextOffset");
    data.conversations.forEach(
      (c: { conversationId: string; lastAt: number; stepCount: number }) => {
        expect(typeof c.conversationId).toBe("string");
        expect(typeof c.lastAt).toBe("number");
        expect(typeof c.stepCount).toBe("number");
      }
    );
  });

  it("GET /api/queues/message-log with conversationId returns steps and nextCursor", async () => {
    const convId = "msglog-steps-" + Date.now();
    const now = Date.now();
    const id1 = "step-a-" + now;
    const id2 = "step-b-" + now;
    await db
      .insert(messageQueueLog)
      .values({
        id: id1,
        conversationId: convId,
        messageId: null,
        type: "trace_step",
        phase: "prepare",
        label: "Preparing…",
        payload: null,
        createdAt: now,
      })
      .run();
    await db
      .insert(messageQueueLog)
      .values({
        id: id2,
        conversationId: convId,
        messageId: null,
        type: "trace_step",
        phase: "rephrase",
        label: "Rephrasing…",
        payload: JSON.stringify({ inputPreview: "hi" }),
        createdAt: now + 10,
      })
      .run();
    try {
      const res = await getMessageLog(
        new Request(
          `http://localhost/api/queues/message-log?conversationId=${encodeURIComponent(convId)}`
        )
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty("steps");
      expect(data).toHaveProperty("nextCursor");
      expect(Array.isArray(data.steps)).toBe(true);
      expect(data.steps).toHaveLength(2);
      expect(data.steps[0].id).toBe(id1);
      expect(data.steps[0].type).toBe("trace_step");
      expect(data.steps[0].phase).toBe("prepare");
      expect(data.steps[0].label).toBe("Preparing…");
      expect(data.steps[1].id).toBe(id2);
      expect(data.steps[1].payload).toBe(JSON.stringify({ inputPreview: "hi" }));
      expect(data.nextCursor).toBe(null);
    } finally {
      await db.delete(messageQueueLog).where(eq(messageQueueLog.conversationId, convId)).run();
    }
  });

  it("GET /api/queues/message-log returns error steps with errorCode and message for debugging", async () => {
    const convId = "msglog-error-" + Date.now();
    const now = Date.now();
    const id1 = "err-step-" + now;
    const payload = { error: "Request failed or connection lost.", errorCode: "CHAT_TURN_ERROR" };
    await db
      .insert(messageQueueLog)
      .values({
        id: id1,
        conversationId: convId,
        messageId: null,
        type: "error",
        phase: null,
        label: "Error",
        payload: JSON.stringify(payload),
        createdAt: now,
      })
      .run();
    try {
      const res = await getMessageLog(
        new Request(
          `http://localhost/api/queues/message-log?conversationId=${encodeURIComponent(convId)}`
        )
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.steps)).toBe(true);
      expect(data.steps).toHaveLength(1);
      expect(data.steps[0].id).toBe(id1);
      expect(data.steps[0].type).toBe("error");
      expect(data.steps[0].label).toBe("Error");
      const parsed = JSON.parse(data.steps[0].payload) as Record<string, unknown>;
      expect(parsed.error).toBe("Request failed or connection lost.");
      expect(parsed.errorCode).toBe("CHAT_TURN_ERROR");
    } finally {
      await db.delete(messageQueueLog).where(eq(messageQueueLog.conversationId, convId)).run();
    }
  });

  it("GET /api/queues/message-log returns planner_response step with raw planner output for debugging", async () => {
    const convId = "msglog-planner-" + Date.now();
    const now = Date.now();
    const id1 = "planner-step-" + now;
    const rawPlannerOutput =
      '{"priorityOrder": ["general", "agent"], "refinedTask": "Create an agent.", "extractedContext": {"savedSearchUrl": "https://example.com/search"}}';
    const parsedPlan = {
      priorityOrder: ["general", "agent"],
      refinedTask: "Create an agent.",
      extractedContext: { savedSearchUrl: "https://example.com/search" },
    };
    const payload = JSON.stringify({
      type: "trace_step",
      phase: "planner_response",
      label: "Planner output",
      rawResponse: rawPlannerOutput,
      parsedPlan,
    });
    await db
      .insert(messageQueueLog)
      .values({
        id: id1,
        conversationId: convId,
        messageId: null,
        type: "trace_step",
        phase: "planner_response",
        label: "Planner output",
        payload,
        createdAt: now,
      })
      .run();
    try {
      const res = await getMessageLog(
        new Request(
          `http://localhost/api/queues/message-log?conversationId=${encodeURIComponent(convId)}`
        )
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.steps)).toBe(true);
      expect(data.steps).toHaveLength(1);
      expect(data.steps[0].id).toBe(id1);
      expect(data.steps[0].phase).toBe("planner_response");
      expect(data.steps[0].label).toBe("Planner output");
      const parsed = JSON.parse(data.steps[0].payload) as Record<string, unknown>;
      expect(parsed.rawResponse).toBe(rawPlannerOutput);
      expect(parsed.parsedPlan).toEqual(parsedPlan);
    } finally {
      await db.delete(messageQueueLog).where(eq(messageQueueLog.conversationId, convId)).run();
    }
  });

  it("GET /api/queues/message-log returns planner_response step with empty rawResponse (UI shows placeholder)", async () => {
    const convId = "msglog-planner-empty-" + Date.now();
    const now = Date.now();
    const id1 = "planner-empty-" + now;
    const payload = JSON.stringify({
      type: "trace_step",
      phase: "planner_response",
      label: "Planner output",
      rawResponse: "",
      parsedPlan: { priorityOrder: ["general"], refinedTask: "Do something." },
    });
    await db
      .insert(messageQueueLog)
      .values({
        id: id1,
        conversationId: convId,
        messageId: null,
        type: "trace_step",
        phase: "planner_response",
        label: "Planner output",
        payload,
        createdAt: now,
      })
      .run();
    try {
      const res = await getMessageLog(
        new Request(
          `http://localhost/api/queues/message-log?conversationId=${encodeURIComponent(convId)}`
        )
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.steps)).toBe(true);
      expect(data.steps).toHaveLength(1);
      expect(data.steps[0].phase).toBe("planner_response");
      const parsed = JSON.parse(data.steps[0].payload) as Record<string, unknown>;
      expect(parsed.rawResponse).toBe("");
      expect(parsed.parsedPlan).toEqual({
        priorityOrder: ["general"],
        refinedTask: "Do something.",
      });
    } finally {
      await db.delete(messageQueueLog).where(eq(messageQueueLog.conversationId, convId)).run();
    }
  });

  it("GET /api/queues/message-log with conversationId and limit paginates steps", async () => {
    const convId = "msglog-pag-" + Date.now();
    const now = Date.now();
    const ids = ["p1", "p2", "p3", "p4"].map((s, i) => `msglog-pag-${s}-${now + i}`);
    for (let i = 0; i < 4; i++) {
      await db
        .insert(messageQueueLog)
        .values({
          id: ids[i],
          conversationId: convId,
          messageId: null,
          type: "trace_step",
          phase: "step",
          label: `Step ${i}`,
          payload: null,
          createdAt: now + i,
        })
        .run();
    }
    try {
      const res = await getMessageLog(
        new Request(
          `http://localhost/api/queues/message-log?conversationId=${encodeURIComponent(convId)}&limit=2`
        )
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.steps).toHaveLength(2);
      expect(data.nextCursor).not.toBe(null);
      expect(data.steps[0].id).toBe(ids[0]);
      expect(data.steps[1].id).toBe(ids[1]);
      const cursor = data.nextCursor as string;
      const res2 = await getMessageLog(
        new Request(
          `http://localhost/api/queues/message-log?conversationId=${encodeURIComponent(convId)}&limit=2&cursor=${encodeURIComponent(cursor)}`
        )
      );
      expect(res2.status).toBe(200);
      const data2 = await res2.json();
      expect(data2.steps).toHaveLength(2);
      expect(data2.steps[0].id).toBe(ids[2]);
      expect(data2.steps[1].id).toBe(ids[3]);
      expect(data2.nextCursor).toBe(null);
    } finally {
      await db.delete(messageQueueLog).where(eq(messageQueueLog.conversationId, convId)).run();
    }
  });

  it("GET /api/queues/message-log without conversationId returns paginated conversations with nextOffset", async () => {
    const convId = "msglog-conv-" + Date.now();
    const now = Date.now();
    await db
      .insert(messageQueueLog)
      .values({
        id: "c1-" + now,
        conversationId: convId,
        messageId: null,
        type: "trace_step",
        phase: "x",
        label: "X",
        payload: null,
        createdAt: now,
      })
      .run();
    try {
      const res = await getMessageLog(
        new Request("http://localhost/api/queues/message-log?limit=20&offset=0")
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.conversations)).toBe(true);
      const found = data.conversations.find(
        (c: { conversationId: string }) => c.conversationId === convId
      );
      expect(found).toBeDefined();
      expect(found.lastAt).toBe(now);
      expect(found.stepCount).toBe(1);
    } finally {
      await db.delete(messageQueueLog).where(eq(messageQueueLog.conversationId, convId)).run();
    }
  });

  it("GET /api/queues/message-log with unknown conversationId returns empty steps", async () => {
    const res = await getMessageLog(
      new Request(
        "http://localhost/api/queues/message-log?conversationId=no-such-conversation-id-12345"
      )
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.steps).toHaveLength(0);
    expect(data.nextCursor).toBe(null);
  });
});
