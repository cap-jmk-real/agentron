import { describe, it, expect, vi } from "vitest";
import { processChatStreamEvent } from "../../app/hooks/useChatStream";

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
    setMessages.mockImplementation(
      (fn: (prev: { id: string; content: string }[]) => { id: string; content: string }[]) =>
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
