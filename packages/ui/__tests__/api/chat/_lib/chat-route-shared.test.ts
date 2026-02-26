import { describe, it, expect } from "vitest";
import {
  truncateForTrace,
  capForTrace,
  sanitizeDonePayload,
  buildRecentConversationContext,
  extractContentFromRawResponse,
  TRACE_PAYLOAD_MAX,
  DONE_TOOL_RESULT_MAX,
} from "../../../../app/api/chat/_lib/chat-route-shared";

describe("chat-route-shared", () => {
  describe("extractContentFromRawResponse", () => {
    it("returns empty for null or undefined", () => {
      expect(extractContentFromRawResponse(null)).toBe("");
      expect(extractContentFromRawResponse(undefined)).toBe("");
    });

    it("returns String for non-object", () => {
      expect(extractContentFromRawResponse(42)).toBe("42");
    });

    it("returns trimmed string when content is string", () => {
      const raw = { choices: [{ message: { content: "  hello  " } }] };
      expect(extractContentFromRawResponse(raw)).toBe("hello");
    });

    it("extracts text from content array of parts with text", () => {
      const raw = {
        choices: [
          {
            message: {
              content: [
                { text: "Hello " },
                { text: "world" },
                { type: "image" },
                {},
                { text: "!" },
              ],
            },
          },
        ],
      };
      expect(extractContentFromRawResponse(raw)).toBe("Hello world!");
    });

    it("returns empty when no choices or wrong shape", () => {
      expect(extractContentFromRawResponse({})).toBe("");
      expect(extractContentFromRawResponse({ choices: [] })).toBe("");
    });
  });

  describe("truncateForTrace", () => {
    it("returns null and undefined as-is", () => {
      expect(truncateForTrace(null)).toBe(null);
      expect(truncateForTrace(undefined)).toBe(undefined);
    });

    it("returns value when string length <= TRACE_PAYLOAD_MAX", () => {
      const short = "x".repeat(TRACE_PAYLOAD_MAX);
      expect(truncateForTrace(short)).toBe(short);
    });

    it("truncates long string with ellipsis", () => {
      const long = "a".repeat(TRACE_PAYLOAD_MAX + 100);
      const out = truncateForTrace(long);
      expect(typeof out).toBe("string");
      expect((out as string).length).toBe(TRACE_PAYLOAD_MAX + 1);
      expect((out as string).endsWith("…")).toBe(true);
    });

    it("stringifies non-string and truncates when over limit", () => {
      const obj = { x: "y".repeat(500) };
      const out = truncateForTrace(obj);
      expect(typeof out).toBe("string");
      expect((out as string).endsWith("…")).toBe(true);
    });
  });

  describe("capForTrace", () => {
    it("returns null and undefined as-is", () => {
      expect(capForTrace(null, 100)).toBe(null);
      expect(capForTrace(undefined, 100)).toBe(undefined);
    });

    it("returns value when string length <= maxLen", () => {
      expect(capForTrace("hello", 10)).toBe("hello");
    });

    it("truncates long string with ellipsis at maxLen", () => {
      const out = capForTrace("x".repeat(200), 50);
      expect((out as string).length).toBe(51);
      expect((out as string).endsWith("…")).toBe(true);
    });
  });

  describe("sanitizeDonePayload", () => {
    it("returns minimal done payload with type only", () => {
      const out = sanitizeDonePayload({ type: "done" });
      expect(out).toEqual({ type: "done" });
    });

    it("includes content and status when provided", () => {
      const out = sanitizeDonePayload({
        type: "done",
        content: "Hello",
        status: "completed",
      });
      expect(out).toEqual({ type: "done", content: "Hello", status: "completed" });
    });

    it("includes conversationTitle, rephrasedPrompt, planSummary, completedStepIndices, reasoning, todos, messageId, userMessageId, conversationId, interactivePrompt when provided", () => {
      const out = sanitizeDonePayload({
        type: "done",
        content: "c",
        messageId: "msg-1",
        userMessageId: "user-msg-1",
        conversationId: "conv-1",
        conversationTitle: "My Chat",
        rephrasedPrompt: "Rephrased",
        planSummary: { refinedTask: "t", route: ["step1"] },
        completedStepIndices: [0, 1],
        reasoning: "reason",
        todos: ["a", "b"],
        interactivePrompt: { question: "Q?", options: ["A", "B"] },
      });
      expect(out.conversationTitle).toBe("My Chat");
      expect(out.rephrasedPrompt).toBe("Rephrased");
      expect(out.planSummary).toEqual({ refinedTask: "t", route: ["step1"] });
      expect(out.completedStepIndices).toEqual([0, 1]);
      expect(out.reasoning).toBe("reason");
      expect(out.todos).toEqual(["a", "b"]);
      expect(out.messageId).toBe("msg-1");
      expect(out.userMessageId).toBe("user-msg-1");
      expect(out.conversationId).toBe("conv-1");
      expect(out.interactivePrompt).toEqual({ question: "Q?", options: ["A", "B"] });
    });

    it("safeResult keeps null, boolean, number, and short string as-is", () => {
      const out = sanitizeDonePayload({
        type: "done",
        toolResults: [
          { name: "n", args: {}, result: null },
          { name: "n2", args: {}, result: true },
          { name: "n3", args: {}, result: 42 },
          { name: "n4", args: {}, result: "hello" },
        ],
      });
      expect(out.toolResults).toEqual([
        { name: "n", args: {}, result: null },
        { name: "n2", args: {}, result: true },
        { name: "n3", args: {}, result: 42 },
        { name: "n4", args: {}, result: "hello" },
      ]);
    });

    it("safeResult truncates long string in tool result", () => {
      const long = "z".repeat(DONE_TOOL_RESULT_MAX + 50);
      const out = sanitizeDonePayload({
        type: "done",
        toolResults: [{ name: "n", args: {}, result: long }],
      });
      const r = (out.toolResults as { result: unknown }[])[0].result as string;
      expect(r.length).toBe(DONE_TOOL_RESULT_MAX + 1);
      expect(r.endsWith("…")).toBe(true);
    });

    it("safeResult caps array at 50 elements", () => {
      const arr = Array.from({ length: 60 }, (_, i) => i);
      const out = sanitizeDonePayload({
        type: "done",
        toolResults: [{ name: "n", args: {}, result: arr }],
      });
      const r = (out.toolResults as { result: unknown }[])[0].result as unknown[];
      expect(r.length).toBe(50);
    });

    it("safeResult returns _truncated preview for large object", () => {
      const big = { x: "y".repeat(10000) };
      const out = sanitizeDonePayload({
        type: "done",
        toolResults: [{ name: "n", args: {}, result: big }],
      });
      const r = (out.toolResults as { result: unknown }[])[0].result as Record<string, unknown>;
      expect(r._truncated).toBe(true);
      expect(typeof r.preview).toBe("string");
    });

    it("safeResult preserves status, id, workflowId when truncating large object (e2e execute_workflow / create_* contract)", () => {
      const big = {
        id: "run-uuid-123",
        workflowId: "wf-uuid-456",
        status: "completed",
        message: "Workflow run completed.",
        output: { trail: [{ nodeId: "n1", output: "x".repeat(10000) }] },
      };
      const out = sanitizeDonePayload({
        type: "done",
        toolResults: [{ name: "execute_workflow", args: {}, result: big }],
      });
      const r = (out.toolResults as { result: unknown }[])[0].result as Record<string, unknown>;
      expect(r._truncated).toBe(true);
      expect(r.status).toBe("completed");
      expect(r.id).toBe("run-uuid-123");
      expect(r.workflowId).toBe("wf-uuid-456");
    });

    it("safeResult returns _truncated _reason non-serializable when JSON.stringify throws", () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      const out = sanitizeDonePayload({
        type: "done",
        toolResults: [{ name: "n", args: {}, result: circular }],
      });
      const r = (out.toolResults as { result: unknown }[])[0].result as Record<string, unknown>;
      expect(r._truncated).toBe(true);
      expect(r._reason).toBe("non-serializable");
    });

    it("safeResult uses String() for non-primitive non-array non-object result", () => {
      const out = sanitizeDonePayload({
        type: "done",
        toolResults: [
          { name: "n", args: {}, result: Symbol("sym") as unknown },
          { name: "n2", args: {}, result: (() => 1) as unknown },
        ],
      });
      const r0 = (out.toolResults as { result: unknown }[])[0].result as string;
      const r1 = (out.toolResults as { result: unknown }[])[1].result as string;
      expect(typeof r0).toBe("string");
      expect(typeof r1).toBe("string");
    });

    it("uses empty object for non-object args", () => {
      const out = sanitizeDonePayload({
        type: "done",
        toolResults: [{ name: "n", args: null as unknown as Record<string, unknown>, result: 1 }],
      });
      expect((out.toolResults as { args: Record<string, unknown> }[])[0].args).toEqual({});
    });

    it("passes through specialistId when present in toolResults (for debugging)", () => {
      const out = sanitizeDonePayload({
        type: "done",
        toolResults: [
          { name: "create_agent", args: {}, result: { id: "a1" }, specialistId: "agent_lifecycle" },
          {
            name: "create_workflow",
            args: {},
            result: { id: "w1" },
            specialistId: "workflow_design",
          },
        ],
      });
      expect(out.toolResults).toHaveLength(2);
      expect((out.toolResults as { name: string; specialistId?: string }[])[0].specialistId).toBe(
        "agent_lifecycle"
      );
      expect((out.toolResults as { name: string; specialistId?: string }[])[1].specialistId).toBe(
        "workflow_design"
      );
    });

    it("includes conversationTitle, rephrasedPrompt, planSummary, and other optional fields when provided", () => {
      const out = sanitizeDonePayload({
        type: "done",
        content: "Hi",
        messageId: "msg-1",
        userMessageId: "user-msg-1",
        conversationId: "conv-1",
        conversationTitle: "My Chat",
        reasoning: "Because...",
        todos: ["a", "b"],
        completedStepIndices: [0, 1],
        rephrasedPrompt: "Rephrased",
        planSummary: { refinedTask: "task", route: ["step1"] },
        interactivePrompt: { question: "Q?", options: ["A", "B"] },
      });
      expect(out.conversationTitle).toBe("My Chat");
      expect(out.rephrasedPrompt).toBe("Rephrased");
      expect(out.planSummary).toEqual({ refinedTask: "task", route: ["step1"] });
      expect(out.reasoning).toBe("Because...");
      expect(out.todos).toEqual(["a", "b"]);
      expect(out.completedStepIndices).toEqual([0, 1]);
      expect(out.messageId).toBe("msg-1");
      expect(out.interactivePrompt).toEqual({ question: "Q?", options: ["A", "B"] });
    });
  });

  describe("buildRecentConversationContext", () => {
    it("returns empty string for empty history", () => {
      expect(buildRecentConversationContext([], 10)).toBe("");
    });

    it("formats last N messages as role: content", () => {
      const history: { role: string; content: string }[] = [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
      ];
      const out = buildRecentConversationContext(history as never, 10);
      expect(out).toContain("user: Hi");
      expect(out).toContain("assistant: Hello");
    });

    it("slices to maxMessages", () => {
      const history: { role: string; content: string }[] = [
        { role: "user", content: "1" },
        { role: "assistant", content: "2" },
        { role: "user", content: "3" },
      ];
      const out = buildRecentConversationContext(history as never, 2);
      expect(out).not.toContain("user: 1");
      expect(out).toContain("assistant: 2");
      expect(out).toContain("user: 3");
    });

    it("appends current user message when provided", () => {
      const history: { role: string; content: string }[] = [{ role: "user", content: "Hi" }];
      const out = buildRecentConversationContext(history as never, 10, {
        appendCurrentMessage: "  New message  ",
      });
      expect(out).toContain("user: New message");
    });

    it("does not append when appendCurrentMessage is whitespace only", () => {
      const history: { role: string; content: string }[] = [{ role: "user", content: "Hi" }];
      const out = buildRecentConversationContext(history as never, 10, {
        appendCurrentMessage: "   ",
      });
      expect(out).toBe("user: Hi");
    });

    it("does not append when options is provided but appendCurrentMessage is undefined", () => {
      const history: { role: string; content: string }[] = [{ role: "user", content: "Hi" }];
      const out = buildRecentConversationContext(history as never, 10, {});
      expect(out).toBe("user: Hi");
    });

    it("stringifies non-string message content", () => {
      const history: { role: string; content: unknown }[] = [
        { role: "user", content: { parts: ["a"] } },
        { role: "assistant", content: ["text", "more"] },
      ];
      const out = buildRecentConversationContext(history as never, 10);
      expect(out).toContain('{"parts":["a"]}');
      expect(out).toContain('["text","more"]');
    });

    it("stringifies null or undefined message content as empty string", () => {
      const history: { role: string; content: unknown }[] = [
        { role: "user", content: null },
        { role: "assistant", content: undefined },
      ];
      const out = buildRecentConversationContext(history as never, 10);
      expect(out).toContain('user: ""');
      expect(out).toContain('assistant: ""');
    });
  });
});
