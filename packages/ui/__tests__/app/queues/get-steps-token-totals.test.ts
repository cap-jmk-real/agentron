import { describe, it, expect } from "vitest";
import { getStepsTokenTotals } from "../../../app/queues/_lib/get-steps-token-totals";

describe("getStepsTokenTotals", () => {
  it("returns zeros when steps are empty", () => {
    const result = getStepsTokenTotals([]);
    expect(result).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
  });

  it("returns zeros when no step has usage in payload", () => {
    const steps = [
      { payload: JSON.stringify({ phase: "user_input", label: "User input" }) },
      { payload: null },
      { payload: "not valid json" },
    ];
    const result = getStepsTokenTotals(steps);
    expect(result).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
  });

  it("sums usage from llm_response steps", () => {
    const steps = [
      {
        payload: JSON.stringify({
          phase: "llm_response",
          usage: { promptTokens: 100, completionTokens: 50 },
        }),
      },
      {
        payload: JSON.stringify({
          phase: "llm_response",
          usage: { promptTokens: 200, completionTokens: 80 },
        }),
      },
    ];
    const result = getStepsTokenTotals(steps);
    expect(result).toEqual({
      promptTokens: 300,
      completionTokens: 130,
      totalTokens: 430,
    });
  });

  it("ignores invalid JSON payloads", () => {
    const steps = [
      { payload: "{ broken" },
      {
        payload: JSON.stringify({
          usage: { promptTokens: 10, completionTokens: 5 },
        }),
      },
    ];
    const result = getStepsTokenTotals(steps);
    expect(result).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
  });

  it("ignores payload.usage when it is not an object", () => {
    const steps = [
      { payload: JSON.stringify({ usage: "string" }) },
      { payload: JSON.stringify({ usage: null }) },
      { payload: JSON.stringify({ usage: [1, 2] }) },
    ];
    const result = getStepsTokenTotals(steps);
    expect(result).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
  });

  it("handles missing or partial usage fields", () => {
    const steps = [
      {
        payload: JSON.stringify({
          usage: { promptTokens: 5 },
        }),
      },
      {
        payload: JSON.stringify({
          usage: { completionTokens: 3 },
        }),
      },
    ];
    const result = getStepsTokenTotals(steps);
    expect(result).toEqual({
      promptTokens: 5,
      completionTokens: 3,
      totalTokens: 8,
    });
  });
});
