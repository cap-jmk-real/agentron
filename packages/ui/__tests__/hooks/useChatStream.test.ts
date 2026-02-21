import { describe, it, expect, vi } from "vitest";
import {
  processChatStreamEvent,
  mapApiMessagesToMessage,
  type ChatStreamMessage,
} from "../../app/hooks/useChatStream";

/** Minimal ctx for processChatStreamEvent; all methods are mocks. */
function mockCtx() {
  return {
    placeholderId: "ph",
    userMsgId: "um",
    updatePlaceholder: vi.fn(),
    setMessages: vi.fn(),
    setConversationId: vi.fn(),
    setConversationList: vi.fn(),
    doneReceived: { current: false },
    onRunFinished: vi.fn(),
    onDone: vi.fn(),
  };
}

describe("useChatStream", () => {
  describe("processChatStreamEvent", () => {
    it("trace_step appends to traceSteps on placeholder message", () => {
      const ctx = mockCtx();
      ctx.setMessages.mockImplementation((fn: (prev: ChatStreamMessage[]) => ChatStreamMessage[]) =>
        fn([
          { id: "ph", role: "assistant", content: "", traceSteps: [{ phase: "a", label: "A" }] },
          { id: "other", role: "user", content: "x" },
        ])
      );
      processChatStreamEvent(
        { type: "trace_step", phase: "step2", label: "Step 2", contentPreview: "preview" },
        ctx
      );
      expect(ctx.setMessages).toHaveBeenCalled();
      const updater = ctx.setMessages.mock.calls[0][0];
      const next = updater([
        { id: "ph", role: "assistant", content: "" },
        { id: "other", role: "user", content: "x" },
      ]);
      const placeholder = next.find((m: { id: string }) => m.id === "ph");
      expect(placeholder?.traceSteps).toEqual([
        { phase: "step2", label: "Step 2", contentPreview: "preview" },
      ]);
    });

    it("rephrased_prompt updates placeholder with rephrasedPrompt", () => {
      const ctx = mockCtx();
      processChatStreamEvent(
        { type: "rephrased_prompt", rephrasedPrompt: "Rephrased user intent" },
        ctx
      );
      expect(ctx.updatePlaceholder).toHaveBeenCalledWith({ rephrasedPrompt: "Rephrased user intent" });
    });

    it("plan updates placeholder with reasoning and todos", () => {
      const ctx = mockCtx();
      processChatStreamEvent(
        {
          type: "plan",
          reasoning: "We will do X",
          todos: ["Step 1", "Step 2"],
        },
        ctx
      );
      expect(ctx.updatePlaceholder).toHaveBeenCalledWith(
        expect.objectContaining({
          reasoning: "We will do X",
          todos: ["Step 1", "Step 2"],
          completedStepIndices: [],
          executingStepIndex: undefined,
          executingToolName: undefined,
          executingTodoLabel: undefined,
          executingSubStepLabel: undefined,
        }),
        true
      );
    });

    it("step_start updates placeholder with executing step and tool labels", () => {
      const ctx = mockCtx();
      processChatStreamEvent(
        {
          type: "step_start",
          stepIndex: 1,
          toolName: "web_search",
          todoLabel: "Search the web",
          subStepLabel: "Query",
        },
        ctx
      );
      expect(ctx.updatePlaceholder).toHaveBeenCalledWith(
        expect.objectContaining({
          executingStepIndex: 1,
          executingToolName: "web_search",
          executingTodoLabel: "Search the web",
          executingSubStepLabel: "Query",
        }),
        true
      );
    });

    it("todo_done appends index to completedStepIndices on placeholder", () => {
      const ctx = mockCtx();
      ctx.setMessages.mockImplementation((fn: (prev: ChatStreamMessage[]) => ChatStreamMessage[]) =>
        fn([
          { id: "ph", role: "assistant", content: "", completedStepIndices: [0] },
        ])
      );
      processChatStreamEvent({ type: "todo_done", index: 1 }, ctx);
      expect(ctx.setMessages).toHaveBeenCalled();
      const updater = ctx.setMessages.mock.calls[0][0];
      const next = updater([
        { id: "ph", role: "assistant", content: "", completedStepIndices: [0] },
      ]);
      const placeholder = next.find((m: { id: string }) => m.id === "ph");
      expect(placeholder?.completedStepIndices).toEqual([0, 1]);
    });

    it("done sets doneReceived and calls updatePlaceholder with content and ids", () => {
      const ctx = mockCtx();
      processChatStreamEvent(
        {
          type: "done",
          content: "Final answer",
          messageId: "msg-1",
          userMessageId: "user-1",
          conversationId: "conv-1",
          conversationTitle: "Title",
        },
        ctx
      );
      expect(ctx.doneReceived.current).toBe(true);
      expect(ctx.updatePlaceholder).toHaveBeenCalledWith(
        expect.objectContaining({ content: "Final answer" }),
        true
      );
      expect(ctx.setConversationId).toHaveBeenCalledWith("conv-1");
      expect(ctx.setConversationList).toHaveBeenCalled();
    });

    it("done with execute_workflow result calls onRunFinished when status is completed", () => {
      const ctx = mockCtx();
      processChatStreamEvent(
        {
          type: "done",
          content: "Done",
          toolResults: [
            {
              name: "execute_workflow",
              args: {},
              result: { id: "run-1", status: "completed" },
            },
          ],
        },
        ctx
      );
      expect(ctx.onRunFinished).toHaveBeenCalledWith("run-1", "completed", undefined);
    });

    it("done with execute_workflow waiting_for_user calls onRunFinished with question/options", () => {
      const ctx = mockCtx();
      processChatStreamEvent(
        {
          type: "done",
          content: "",
          toolResults: [
            {
              name: "execute_workflow",
              args: {},
              result: {
                id: "run-2",
                status: "waiting_for_user",
                question: "Choose one",
                options: ["A", "B"],
              },
            },
          ],
        },
        ctx
      );
      expect(ctx.onRunFinished).toHaveBeenCalledWith("run-2", "waiting_for_user", {
        question: "Choose one",
        options: ["A", "B"],
      });
    });

    it("done uses last execute_workflow result when multiple", () => {
      const ctx = mockCtx();
      processChatStreamEvent(
        {
          type: "done",
          content: "",
          toolResults: [
            { name: "execute_workflow", args: {}, result: { id: "r1", status: "failed" } },
            { name: "execute_workflow", args: {}, result: { id: "r2", status: "completed" } },
          ],
        },
        ctx
      );
      expect(ctx.onRunFinished).toHaveBeenCalledWith("r2", "completed", undefined);
    });

    it("done with empty toolResults does not call onRunFinished", () => {
      const ctx = mockCtx();
      processChatStreamEvent(
        { type: "done", content: "Done.", toolResults: [] },
        ctx
      );
      expect(ctx.onRunFinished).not.toHaveBeenCalled();
    });

    it("done with toolResults but no execute_workflow does not call onRunFinished", () => {
      const ctx = mockCtx();
      processChatStreamEvent(
        {
          type: "done",
          content: "Done.",
          toolResults: [
            { name: "list_workflows", args: {}, result: [] },
            { name: "create_agent", args: { name: "A" }, result: { id: "agent-1" } },
          ],
        },
        ctx
      );
      expect(ctx.onRunFinished).not.toHaveBeenCalled();
    });

    it("done with execute_workflow status failed calls onRunFinished", () => {
      const ctx = mockCtx();
      processChatStreamEvent(
        {
          type: "done",
          content: "Run failed",
          toolResults: [
            { name: "execute_workflow", args: {}, result: { id: "run-1", status: "failed", error: "Workflow error" } },
          ],
        },
        ctx
      );
      expect(ctx.onRunFinished).toHaveBeenCalledWith("run-1", "failed", undefined);
    });

    it("done with execute_workflow status cancelled calls onRunFinished", () => {
      const ctx = mockCtx();
      processChatStreamEvent(
        {
          type: "done",
          content: "Run was stopped",
          toolResults: [
            { name: "execute_workflow", args: {}, result: { id: "run-2", status: "cancelled", message: "Run was stopped by the user." } },
          ],
        },
        ctx
      );
      expect(ctx.onRunFinished).toHaveBeenCalledWith("run-2", "cancelled", undefined);
    });

    it("done with execute_workflow result missing id does not call onRunFinished", () => {
      const ctx = mockCtx();
      processChatStreamEvent(
        {
          type: "done",
          content: "",
          toolResults: [
            { name: "execute_workflow", args: {}, result: { status: "completed" } },
          ],
        },
        ctx
      );
      expect(ctx.onRunFinished).not.toHaveBeenCalled();
    });

    it("done with toolResults undefined does not throw and does not call onRunFinished", () => {
      const ctx = mockCtx();
      expect(() => {
        processChatStreamEvent(
          { type: "done", content: "Ok" },
          ctx
        );
      }).not.toThrow();
      expect(ctx.onRunFinished).not.toHaveBeenCalled();
    });

    it("done calls onDone", () => {
      const ctx = mockCtx();
      processChatStreamEvent({ type: "done", content: "Ok" }, ctx);
      expect(ctx.onDone).toHaveBeenCalled();
    });

    it("error event updates placeholder with error content when done not received", () => {
      const ctx = mockCtx();
      processChatStreamEvent(
        { type: "error", error: "Something broke" },
        ctx
      );
      expect(ctx.updatePlaceholder).toHaveBeenCalledWith(
        { content: "Error: Something broke", traceSteps: [] }
      );
    });

    it("error event with messageId updates message id and content via setMessages", () => {
      const ctx = mockCtx();
      ctx.setMessages.mockImplementation((fn: (prev: ChatStreamMessage[]) => ChatStreamMessage[]) =>
        fn([{ id: "ph", role: "assistant", content: "" }])
      );
      processChatStreamEvent(
        { type: "error", error: "Fail", messageId: "err-msg-1" },
        ctx
      );
      expect(ctx.setMessages).toHaveBeenCalled();
      const updater = ctx.setMessages.mock.calls[0][0];
      const next = updater([{ id: "ph", role: "assistant", content: "" }]);
      expect(next[0]).toMatchObject({ id: "err-msg-1", content: "Error: Fail", traceSteps: [] });
    });
  });

  describe("mapApiMessagesToMessage", () => {
    const noopNormalize = (raw: unknown): { name: string; args: Record<string, unknown>; result: unknown }[] =>
      Array.isArray(raw) ? raw.map((t: { name?: string; args?: unknown; result?: unknown }) => ({ name: t.name ?? "", args: (t.args ?? {}) as Record<string, unknown>, result: t.result })) : [];

    it("returns empty array for non-array input", () => {
      expect(mapApiMessagesToMessage(null as unknown as unknown[], noopNormalize)).toEqual([]);
      expect(mapApiMessagesToMessage(undefined as unknown as unknown[], noopNormalize)).toEqual([]);
      expect(mapApiMessagesToMessage("x" as unknown as unknown[], noopNormalize)).toEqual([]);
    });

    it("maps API rows to ChatStreamMessage with role and content", () => {
      const data = [
        { id: "m1", role: "user", content: "Hello" },
        { id: "m2", role: "assistant", content: "Hi" },
      ];
      const out = mapApiMessagesToMessage(data, noopNormalize);
      expect(out).toHaveLength(2);
      expect(out[0]).toMatchObject({ id: "m1", role: "user", content: "Hello" });
      expect(out[1]).toMatchObject({ id: "m2", role: "assistant", content: "Hi" });
    });

    it("uses normalizeToolResults for toolCalls", () => {
      const data = [
        {
          id: "a1",
          role: "assistant",
          content: "",
          toolCalls: [{ name: "run_workflow", args: { id: "w1" }, result: { ok: true } }],
        },
      ];
      const out = mapApiMessagesToMessage(data, noopNormalize);
      expect(out[0].toolResults).toEqual([
        { name: "run_workflow", args: { id: "w1" }, result: { ok: true } },
      ]);
    });

    it("includes status when present", () => {
      const data = [{ id: "m1", role: "assistant", content: "", status: "waiting_for_input" }];
      const out = mapApiMessagesToMessage(data, noopNormalize);
      expect(out[0].status).toBe("waiting_for_input");
    });

    it("includes interactivePrompt when present", () => {
      const data = [
        {
          id: "m1",
          role: "assistant",
          content: "",
          interactivePrompt: { question: "Yes or no?", options: ["Yes", "No"] },
        },
      ];
      const out = mapApiMessagesToMessage(data, noopNormalize);
      expect(out[0].interactivePrompt).toEqual({ question: "Yes or no?", options: ["Yes", "No"] });
    });
  });
});
