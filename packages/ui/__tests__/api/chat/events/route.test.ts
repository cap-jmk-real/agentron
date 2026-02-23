import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "../../../../app/api/chat/events/route";

const mockSubscribe = vi.fn();
const mockTakePendingJob = vi.fn();
const mockFinish = vi.fn();

vi.mock("../../../../app/api/_lib/chat-event-channel", () => ({
  subscribe: (turnId: string, onEvent: (e: object) => void) => {
    mockSubscribe(turnId, onEvent);
    return () => {};
  },
  takePendingJob: (turnId: string) => mockTakePendingJob(turnId),
  finish: (turnId: string) => mockFinish(turnId),
}));

describe("GET /api/chat/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("with valid turnId and pending job that rejects sends Turn failed and closes", async () => {
    const turnId = "turn-reject-" + Date.now();
    let subscriberCb: ((e: object) => void) | null = null;
    mockSubscribe.mockImplementation((_id: string, cb: (e: object) => void) => {
      subscriberCb = cb;
      return () => {};
    });
    mockTakePendingJob.mockReturnValue(() => Promise.reject(new Error("job failed")));

    const res = await GET(new Request(`http://localhost/api/chat/events?turnId=${turnId}`));
    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (let i = 0; i < 50; i++) {
        const { done, value } = await reader.read();
        if (value) buffer += decoder.decode(value);
        if (done) break;
      }
    } finally {
      reader.releaseLock();
    }

    expect(mockTakePendingJob).toHaveBeenCalledWith(turnId);
    expect(buffer).toContain("Turn failed");
    expect(mockFinish).toHaveBeenCalledWith(turnId);
  });

  it("with valid turnId and no pending job subscribes and accepts abort", async () => {
    const turnId = "turn-abort-" + Date.now();
    mockTakePendingJob.mockReturnValue(undefined);
    const ac = new AbortController();
    const url = `http://localhost/api/chat/events?turnId=${encodeURIComponent(turnId)}`;
    const res = await GET(new Request(url, { signal: ac.signal }));
    expect(res.status).toBe(200);

    ac.abort();
    await new Promise((r) => setTimeout(r, 50));
    expect(mockSubscribe).toHaveBeenCalledWith(turnId, expect.any(Function));
  });

  it("with valid turnId when subscriber receives done event calls finish and close", async () => {
    const turnId = "turn-done-" + Date.now();
    let subscriberCb: ((e: object) => void) | null = null;
    mockSubscribe.mockImplementation((_id: string, cb: (e: object) => void) => {
      subscriberCb = cb;
      return () => {};
    });
    mockTakePendingJob.mockReturnValue(undefined);

    const res = await GET(new Request(`http://localhost/api/chat/events?turnId=${turnId}`));
    expect(res.status).toBe(200);

    const cb = subscriberCb as ((e: object) => void) | null;
    if (cb) cb({ type: "done", content: "ok", messageId: "m1", conversationId: "c1" });
    await new Promise((r) => setTimeout(r, 20));
    expect(mockFinish).toHaveBeenCalledWith(turnId);
  });

  it("when send receives non-serializable event (e.g. circular) sends fallback and does not throw", async () => {
    const turnId = "turn-circular-" + Date.now();
    let subscriberCb: ((e: object) => void) | null = null;
    mockSubscribe.mockImplementation((_id: string, cb: (e: object) => void) => {
      subscriberCb = cb;
      return () => {};
    });
    mockTakePendingJob.mockReturnValue(undefined);

    const res = await GET(new Request(`http://localhost/api/chat/events?turnId=${turnId}`));
    expect(res.status).toBe(200);

    const circular: Record<string, unknown> = { type: "done", content: "x" };
    circular.self = circular;
    const cb1 = subscriberCb as ((e: object) => void) | null;
    if (cb1) cb1(circular);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (let i = 0; i < 20; i++) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value);
      if (done) break;
    }
    reader.releaseLock();
    expect(buffer).toMatch(/data:/);
    expect(mockFinish).toHaveBeenCalledWith(turnId);
  });

  it("when send receives non-serializable non-done event sends error fallback", async () => {
    const turnId = "turn-circular-error-" + Date.now();
    let subscriberCb: ((e: object) => void) | null = null;
    mockSubscribe.mockImplementation((_id: string, cb: (e: object) => void) => {
      subscriberCb = cb;
      return () => {};
    });
    mockTakePendingJob.mockReturnValue(undefined);

    const res = await GET(new Request(`http://localhost/api/chat/events?turnId=${turnId}`));
    expect(res.status).toBe(200);

    const circular: Record<string, unknown> = { type: "error", error: "x" };
    circular.self = circular;
    const cb2 = subscriberCb as ((e: object) => void) | null;
    if (cb2) cb2(circular);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (let i = 0; i < 20; i++) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value);
      if (done) break;
    }
    reader.releaseLock();
    expect(buffer).toContain("Event delivery failed");
    expect(mockFinish).toHaveBeenCalledWith(turnId);
  });

  it("when subscriber receives error event calls finish and closes controller", async () => {
    const turnId = "turn-error-" + Date.now();
    let subscriberCb: ((e: object) => void) | null = null;
    mockSubscribe.mockImplementation((_id: string, cb: (e: object) => void) => {
      subscriberCb = cb;
      return () => {};
    });
    mockTakePendingJob.mockReturnValue(undefined);

    const res = await GET(new Request(`http://localhost/api/chat/events?turnId=${turnId}`));
    expect(res.status).toBe(200);

    const cb3 = subscriberCb as ((e: object) => void) | null;
    if (cb3) cb3({ type: "error", error: "Something went wrong" });
    await new Promise((r) => setTimeout(r, 20));
    expect(mockFinish).toHaveBeenCalledWith(turnId);
  });

  it("when request has no signal still subscribes and returns stream", async () => {
    const turnId = "turn-no-signal-" + Date.now();
    mockTakePendingJob.mockReturnValue(undefined);
    const req = new Request(`http://localhost/api/chat/events?turnId=${turnId}`);
    expect(req.signal).toBeDefined();
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
    expect(mockSubscribe).toHaveBeenCalledWith(turnId, expect.any(Function));
  });

  it("when abort fires after done event controller.close in abort handler is no-op (catch branch)", async () => {
    const turnId = "turn-abort-after-done-" + Date.now();
    let subscriberCb: ((e: object) => void) | null = null;
    mockSubscribe.mockImplementation((_id: string, cb: (e: object) => void) => {
      subscriberCb = cb;
      return () => {};
    });
    mockTakePendingJob.mockReturnValue(undefined);
    const ac = new AbortController();
    const res = await GET(
      new Request(`http://localhost/api/chat/events?turnId=${turnId}`, { signal: ac.signal })
    );
    expect(res.status).toBe(200);

    const cb = subscriberCb as ((e: object) => void) | null;
    if (cb) cb({ type: "done", content: "ok" });
    await new Promise((r) => setTimeout(r, 30));
    ac.abort();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockFinish).toHaveBeenCalledWith(turnId);
  });
});
