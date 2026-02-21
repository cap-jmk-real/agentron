import { describe, it, expect } from "vitest";
import { isToolResultFailure, type ExecutionTraceStep } from "../../../app/api/_lib/run-workflow";

describe("run-workflow ExecutionTraceStep", () => {
  it("allows optional sentToNodeId, sentToAgentName, llmSummary for atomistic run view", () => {
    const step: ExecutionTraceStep = {
      nodeId: "n1",
      agentId: "a1",
      agentName: "Writer",
      order: 0,
      input: "Draft the intro",
      output: "Here is the draft.",
      sentToNodeId: "n2",
      sentToAgentName: "Reviewer",
      llmSummary: "2 rounds, 1 tool call",
    };
    expect(step.sentToNodeId).toBe("n2");
    expect(step.sentToAgentName).toBe("Reviewer");
    expect(step.llmSummary).toBe("2 rounds, 1 tool call");
    const json = JSON.stringify(step);
    const parsed = JSON.parse(json) as ExecutionTraceStep;
    expect(parsed.sentToNodeId).toBe("n2");
    expect(parsed.llmSummary).toBe("2 rounds, 1 tool call");
  });
});

describe("run-workflow isToolResultFailure", () => {
  it("returns false for null or non-object", () => {
    expect(isToolResultFailure(null)).toBe(false);
    expect(isToolResultFailure(undefined)).toBe(false);
    expect(isToolResultFailure("ok")).toBe(false);
    expect(isToolResultFailure(0)).toBe(false);
  });

  it("returns true when error is non-empty string", () => {
    expect(isToolResultFailure({ error: "Something failed" })).toBe(true);
    expect(isToolResultFailure({ error: "x" })).toBe(true);
    expect(isToolResultFailure({ error: "", stdout: "ok" })).toBe(false);
    expect(isToolResultFailure({ error: "   " })).toBe(false);
  });

  it("returns true when exitCode is non-zero", () => {
    expect(isToolResultFailure({ exitCode: 1 })).toBe(true);
    expect(isToolResultFailure({ exitCode: -1 })).toBe(true);
    expect(isToolResultFailure({ exitCode: 0 })).toBe(false);
    expect(isToolResultFailure({ exitCode: 0, stdout: "done" })).toBe(false);
  });

  it("returns true when statusCode or status is 4xx/5xx", () => {
    expect(isToolResultFailure({ statusCode: 400 })).toBe(true);
    expect(isToolResultFailure({ statusCode: 404 })).toBe(true);
    expect(isToolResultFailure({ statusCode: 500 })).toBe(true);
    expect(isToolResultFailure({ status: 502 })).toBe(true);
    expect(isToolResultFailure({ statusCode: 200 })).toBe(false);
    expect(isToolResultFailure({ statusCode: 301 })).toBe(false);
  });
});
