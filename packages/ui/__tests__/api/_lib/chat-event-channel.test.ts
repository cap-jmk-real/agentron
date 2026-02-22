import { describe, it, expect, vi, afterEach } from "vitest";
import {
  subscribe,
  publish,
  finish,
  isFinished,
  setPendingJob,
  takePendingJob,
  hasPendingJob,
} from "../../../app/api/_lib/chat-event-channel";

describe("chat-event-channel", () => {
  afterEach(() => {
    // Channel is in-memory; tests use unique turnIds so no explicit cleanup needed per test
  });

  it("delivers published events to subscriber", () => {
    const turnId = "turn-" + Date.now();
    const onEvent = vi.fn();
    subscribe(turnId, onEvent);

    publish(turnId, { type: "plan", reasoning: "We will do X", todos: ["A", "B"] });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0][0]).toEqual({
      type: "plan",
      reasoning: "We will do X",
      todos: ["A", "B"],
    });

    publish(turnId, { type: "done", content: "Done" });
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEvent.mock.calls[1][0]).toEqual({ type: "done", content: "Done" });
  });

  it("unsubscribe stops delivery", () => {
    const turnId = "turn-unsub-" + Date.now();
    const onEvent = vi.fn();
    const unsub = subscribe(turnId, onEvent);

    publish(turnId, { type: "trace_step", phase: "a" });
    expect(onEvent).toHaveBeenCalledTimes(1);

    unsub();
    publish(turnId, { type: "trace_step", phase: "b" });
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it("multiple subscribers all receive events", () => {
    const turnId = "turn-multi-" + Date.now();
    const a = vi.fn();
    const b = vi.fn();
    subscribe(turnId, a);
    subscribe(turnId, b);

    publish(turnId, { type: "step_start", stepIndex: 0 });
    expect(a).toHaveBeenCalledWith({ type: "step_start", stepIndex: 0 });
    expect(b).toHaveBeenCalledWith({ type: "step_start", stepIndex: 0 });
  });

  it("finish marks turn and isFinished returns true", () => {
    const turnId = "turn-finish-" + Date.now();
    expect(isFinished(turnId)).toBe(false);
    finish(turnId);
    expect(isFinished(turnId)).toBe(true);
  });

  it("pending job is stored and taken once", () => {
    const turnId = "turn-pending-" + Date.now();
    const job = vi.fn().mockResolvedValue(undefined);
    setPendingJob(turnId, job);

    expect(hasPendingJob(turnId)).toBe(true);
    const taken = takePendingJob(turnId);
    expect(taken).toBe(job);
    expect(hasPendingJob(turnId)).toBe(false);
    expect(takePendingJob(turnId)).toBeUndefined();
  });

  it("takePendingJob returns undefined when no job", () => {
    expect(takePendingJob("nonexistent")).toBeUndefined();
  });

  it("publish does nothing when no subscribers for turnId", () => {
    const turnId = "turn-nosub-" + Date.now();
    expect(() => publish(turnId, { type: "step", index: 0 })).not.toThrow();
  });

  it("publish continues to other subscribers when one throws", () => {
    const turnId = "turn-throw-" + Date.now();
    const ok = vi.fn();
    const bad = vi.fn().mockImplementation(() => {
      throw new Error("subscriber error");
    });
    subscribe(turnId, bad);
    subscribe(turnId, ok);

    publish(turnId, { type: "event" });
    expect(bad).toHaveBeenCalledTimes(1);
    expect(ok).toHaveBeenCalledTimes(1);
    expect(ok).toHaveBeenCalledWith({ type: "event" });
  });
});
