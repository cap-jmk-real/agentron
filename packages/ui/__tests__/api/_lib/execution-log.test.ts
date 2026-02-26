import { describe, it, expect, vi } from "vitest";
import { appendExecutionLogStep, getExecutionLogForRun } from "../../../app/api/_lib/execution-log";
import { db } from "../../../app/api/_lib/db";

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
    const CAP = 500_000;
    const bigPayload = { data: "x".repeat(CAP + 10_000) };
    await appendExecutionLogStep(id4, "tool_result", "tool1", bigPayload);
    const log = await getExecutionLogForRun(id4);
    expect(log).toHaveLength(1);
    const payloadStr = log[0].payload as string;
    const parsed = JSON.parse(payloadStr);
    expect(typeof parsed).toBe("string");
    expect(parsed.length).toBeLessThanOrEqual(CAP + 1);
    expect(parsed.endsWith("…")).toBe(true);
  });

  it("appendExecutionLogStep accepts string payload (capPayload string path) and stores as-is when under limit", async () => {
    const id5 = crypto.randomUUID();
    await appendExecutionLogStep(
      id5,
      "tool_result",
      "t",
      "short string" as unknown as Record<string, unknown>
    );
    const log = await getExecutionLogForRun(id5);
    expect(log).toHaveLength(1);
    expect(log[0].payload).toBe('"short string"');
  });

  it("appendExecutionLogStep stores object payload under cap as-is (capPayload return v branch)", async () => {
    const idUnder = crypto.randomUUID();
    const payload = { data: "x".repeat(100) };
    await appendExecutionLogStep(idUnder, "tool_result", "t", payload);
    const log = await getExecutionLogForRun(idUnder);
    expect(log).toHaveLength(1);
    const parsed = JSON.parse(log[0].payload as string) as Record<string, string>;
    expect(parsed.data).toBe("x".repeat(100));
    expect((log[0].payload as string).length).toBeLessThanOrEqual(500_000);
  });

  it("appendExecutionLogStep caps long string payload", async () => {
    const id6 = crypto.randomUUID();
    const CAP = 500_000;
    const longString = "x".repeat(CAP + 10_000);
    await appendExecutionLogStep(
      id6,
      "tool_result",
      "t",
      longString as unknown as Record<string, unknown>
    );
    const log = await getExecutionLogForRun(id6);
    expect(log).toHaveLength(1);
    const payloadStr = log[0].payload as string;
    expect(payloadStr).toMatch(/^".*"$/);
    const parsed = JSON.parse(payloadStr) as string;
    expect(parsed.length).toBeLessThanOrEqual(CAP + 1);
    expect(parsed.endsWith("…")).toBe(true);
  });

  it("capPayload returns value when string length under limit", async () => {
    const idAt = crypto.randomUUID();
    const exact = "x".repeat(8000);
    await appendExecutionLogStep(
      idAt,
      "tool_result",
      "t",
      exact as unknown as Record<string, unknown>
    );
    const log = await getExecutionLogForRun(idAt);
    expect(log).toHaveLength(1);
    const payloadStr = log[0].payload as string;
    const parsed = JSON.parse(payloadStr) as string;
    expect(parsed).toBe(exact);
    expect(parsed.length).toBe(8000);
  });

  it("getNextSequence returns 1 when existing rows have non-number sequence", async () => {
    const id7 = crypto.randomUUID();
    const selectSpy = vi.spyOn(db, "select").mockReturnValueOnce({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve([{ sequence: "not-a-number" }]),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof db.select>);
    try {
      await appendExecutionLogStep(id7, "phase", "label", {});
      const log = await getExecutionLogForRun(id7);
      expect(log).toHaveLength(1);
      expect(log[0].sequence).toBe(1);
    } finally {
      selectSpy.mockRestore();
    }
  });
});
