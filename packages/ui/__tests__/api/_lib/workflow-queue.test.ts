import { describe, it, expect } from "vitest";
import { enqueueWorkflowRun } from "../../../app/api/_lib/workflow-queue";

describe("workflow-queue", () => {
  it("runs a single job and resolves", async () => {
    let ran = false;
    await enqueueWorkflowRun(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it("runs jobs with concurrency limit", async () => {
    const order: number[] = [];
    const start = (id: number) =>
      enqueueWorkflowRun(async () => {
        order.push(id);
        await new Promise((r) => setTimeout(r, 30));
        order.push(-id);
      });

    const p1 = start(1);
    const p2 = start(2);
    const p3 = start(3);
    await Promise.all([p1, p2, p3]);

    expect(order).toHaveLength(6);
    expect(order.filter((x) => x > 0).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(order.filter((x) => x < 0).sort((a, b) => a - b)).toEqual([-3, -2, -1]);
    const firstTwoStarts = order.indexOf(1) < order.indexOf(3) && order.indexOf(2) < order.indexOf(3);
    expect(firstTwoStarts).toBe(true);
  });

  it("propagates job rejection", async () => {
    await expect(
      enqueueWorkflowRun(async () => {
        throw new Error("job failed");
      })
    ).rejects.toThrow("job failed");
  });
});
