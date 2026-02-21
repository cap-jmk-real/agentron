import { describe, it, expect } from "vitest";
import { appendExecutionLogStep, getExecutionLogForRun } from "../../../app/api/_lib/execution-log";
describe("execution-log", () => {
  const executionId = crypto.randomUUID();

  it("getExecutionLogForRun returns empty array when no steps", async () => {
    const log = await getExecutionLogForRun(executionId);
    expect(log).toEqual([]);
  });

  it("appendExecutionLogStep and getExecutionLogForRun round-trip", async () => {
    await appendExecutionLogStep(executionId, "node_start", "n1", { nodeId: "n1" });
    const log = await getExecutionLogForRun(executionId);
    expect(log).toHaveLength(1);
    expect(log[0].phase).toBe("node_start");
    expect(log[0].label).toBe("n1");
    expect(log[0].payload).toBeDefined();
    expect(JSON.parse(log[0].payload as string)).toEqual({ nodeId: "n1" });
  });

  it("appendExecutionLogStep with null label and null payload", async () => {
    const id2 = crypto.randomUUID();
    await appendExecutionLogStep(id2, "llm_request", null, null);
    const log = await getExecutionLogForRun(id2);
    expect(log).toHaveLength(1);
    expect(log[0].label).toBeNull();
    expect(log[0].payload).toBeNull();
  });

  it("appendExecutionLogStep sequences steps correctly", async () => {
    const id3 = crypto.randomUUID();
    await appendExecutionLogStep(id3, "phase_a", "a", {});
    await appendExecutionLogStep(id3, "phase_b", "b", {});
    const log = await getExecutionLogForRun(id3);
    expect(log).toHaveLength(2);
    expect(log[0].sequence).toBe(1);
    expect(log[1].sequence).toBe(2);
  });

  it("appendExecutionLogStep caps large payload", async () => {
    const id4 = crypto.randomUUID();
    const bigPayload = { data: "x".repeat(10000) };
    await appendExecutionLogStep(id4, "tool_result", "tool1", bigPayload);
    const log = await getExecutionLogForRun(id4);
    expect(log).toHaveLength(1);
    const payloadStr = log[0].payload as string;
    const parsed = JSON.parse(payloadStr);
    expect(typeof parsed).toBe("string");
    expect(parsed.length).toBeLessThanOrEqual(8001);
    expect(parsed.endsWith("…")).toBe(true);
  });
});
