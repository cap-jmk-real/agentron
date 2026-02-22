import { describe, it, expect } from "vitest";
import { getFeedbackForScope } from "../../../app/api/_lib/feedback-for-scope";
import { db, feedback, toFeedbackRow } from "../../../app/api/_lib/db";
import { eq } from "drizzle-orm";

describe("feedback-for-scope", () => {
  it("getFeedbackForScope returns empty array for targetId with no feedback", async () => {
    const items = await getFeedbackForScope("target-no-feedback-" + Date.now());
    expect(items).toEqual([]);
  });

  it("getFeedbackForScope uses default limit when options empty", async () => {
    const items = await getFeedbackForScope("target-default-limit", {});
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeLessThanOrEqual(20);
  });

  it("getFeedbackForScope respects limit option and clamps to MAX_LIMIT", async () => {
    const items5 = await getFeedbackForScope("target-limit-5", { limit: 5 });
    expect(items5.length).toBeLessThanOrEqual(5);
    const items100 = await getFeedbackForScope("target-limit-100", { limit: 100 });
    expect(items100.length).toBeLessThanOrEqual(50);
  });

  it("getFeedbackForScope with label filters by label", async () => {
    const targetId = "target-label-" + Date.now();
    await db
      .insert(feedback)
      .values(
        toFeedbackRow({
          id: crypto.randomUUID(),
          targetType: "agent",
          targetId,
          executionId: null,
          input: {},
          output: {},
          label: "good",
          notes: null,
          createdAt: Date.now(),
        })
      )
      .run();
    const withLabel = await getFeedbackForScope(targetId, { label: "good" });
    expect(withLabel.length).toBeGreaterThanOrEqual(1);
    expect(withLabel.every((f) => f.label === "good")).toBe(true);
    const otherLabel = await getFeedbackForScope(targetId, { label: "bad" });
    expect(otherLabel.length).toBe(0);
  });

  it("getFeedbackForScope returns inputSummary and outputSummary with null/empty truncated", async () => {
    const targetId = "target-summary-" + Date.now();
    await db
      .insert(feedback)
      .values(
        toFeedbackRow({
          id: crypto.randomUUID(),
          targetType: "agent",
          targetId,
          executionId: undefined,
          input: null,
          output: "short",
          label: "good",
          notes: undefined,
          createdAt: Date.now(),
        })
      )
      .run();
    const items = await getFeedbackForScope(targetId);
    expect(items.length).toBeGreaterThanOrEqual(1);
    const item = items.find((f) => f.targetId === targetId);
    expect(item).toBeDefined();
    expect(item!.inputSummary).toBeUndefined();
    expect(item!.outputSummary).toBe("short");
  });

  it("getFeedbackForScope truncates long inputSummary and outputSummary with ellipsis", async () => {
    const targetId = "target-long-" + Date.now();
    const long = "a".repeat(200);
    await db
      .insert(feedback)
      .values(
        toFeedbackRow({
          id: crypto.randomUUID(),
          targetType: "agent",
          targetId,
          executionId: undefined,
          input: long,
          output: { key: "value" },
          label: "good",
          notes: undefined,
          createdAt: Date.now(),
        })
      )
      .run();
    const items = await getFeedbackForScope(targetId);
    const item = items.find((f) => f.targetId === targetId);
    expect(item).toBeDefined();
    expect(item!.inputSummary).toHaveLength(160);
    expect(item!.inputSummary!.endsWith("…")).toBe(true);
    expect(item!.outputSummary).toBe('{"key":"value"}');
  });

  it("getFeedbackForScope uses default limit when limit is 0 or negative", async () => {
    const items = await getFeedbackForScope("any", { limit: 0 });
    expect(items.length).toBeLessThanOrEqual(20);
    const itemsNeg = await getFeedbackForScope("any", { limit: -1 });
    expect(itemsNeg.length).toBeLessThanOrEqual(20);
  });
});
