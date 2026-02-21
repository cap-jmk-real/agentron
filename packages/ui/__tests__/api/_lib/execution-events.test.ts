import { describe, it, expect, beforeAll } from "vitest";
import {
  enqueueExecutionEvent,
  getNextPendingEvent,
  markEventProcessed,
  getExecutionEventsForRun,
  getExecutionRunState,
  setExecutionRunState,
  updateExecutionRunState,
  parseRunStateSharedContext,
  type ExecutionRunStateRow,
} from "../../../app/api/_lib/execution-events";
import { db, executions, toExecutionRow } from "../../../app/api/_lib/db";

describe("execution-events", () => {
  const executionId = crypto.randomUUID();

  beforeAll(async () => {
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: executionId,
          targetType: "workflow",
          targetId: crypto.randomUUID(),
          status: "running",
        })
      )
      .run();
  });

  it("enqueueExecutionEvent returns id and stores event with payload", async () => {
    const id = await enqueueExecutionEvent(executionId, "NodeCompleted", { nodeId: "n1" });
    expect(typeof id).toBe("string");
    const events = await getExecutionEventsForRun(executionId);
    expect(events.some((e) => e.id === id)).toBe(true);
    const ev = events.find((e) => e.id === id);
    expect(ev?.payload).toEqual({ nodeId: "n1" });
  });

  it("enqueueExecutionEvent without payload stores null payload", async () => {
    const id = await enqueueExecutionEvent(executionId, "RunStarted");
    const events = await getExecutionEventsForRun(executionId);
    const ev = events.find((e) => e.id === id);
    expect(ev?.payload).toBeNull();
  });

  it("getNextPendingEvent returns null when no events", async () => {
    const emptyId = crypto.randomUUID();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: emptyId,
          targetType: "workflow",
          targetId: crypto.randomUUID(),
          status: "running",
        })
      )
      .run();
    const next = await getNextPendingEvent(emptyId);
    expect(next).toBeNull();
  });

  it("getNextPendingEvent returns first unprocessed event", async () => {
    const runId = crypto.randomUUID();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: runId,
          targetType: "workflow",
          targetId: crypto.randomUUID(),
          status: "running",
        })
      )
      .run();
    const id1 = await enqueueExecutionEvent(runId, "NodeRequested", { nodeId: "a" });
    await enqueueExecutionEvent(runId, "NodeRequested", { nodeId: "b" });
    const next = await getNextPendingEvent(runId);
    expect(next).not.toBeNull();
    expect(next!.id).toBe(id1);
    expect(next!.payload).toEqual({ nodeId: "a" });
  });

  it("markEventProcessed and getNextPendingEvent return next pending", async () => {
    const runId2 = crypto.randomUUID();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: runId2,
          targetType: "workflow",
          targetId: crypto.randomUUID(),
          status: "running",
        })
      )
      .run();
    const id1 = await enqueueExecutionEvent(runId2, "NodeRequested", {});
    const id2 = await enqueueExecutionEvent(runId2, "NodeRequested", {});
    await markEventProcessed(id1);
    const next = await getNextPendingEvent(runId2);
    expect(next!.id).toBe(id2);
  });

  it("getExecutionRunState returns null when no row", async () => {
    const state = await getExecutionRunState(crypto.randomUUID());
    expect(state).toBeNull();
  });

  it("setExecutionRunState insert and getExecutionRunState", async () => {
    const runId3 = crypto.randomUUID();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: runId3,
          targetType: "workflow",
          targetId: crypto.randomUUID(),
          status: "running",
        })
      )
      .run();
    await setExecutionRunState(runId3, {
      workflowId: "wf1",
      round: 1,
      sharedContext: { key: "value" },
      status: "running",
      trailSnapshot: [{ step: 1 }],
    });
    const state = await getExecutionRunState(runId3);
    expect(state).not.toBeNull();
    expect(state!.workflowId).toBe("wf1");
    expect(state!.round).toBe(1);
    expect(state!.sharedContext).toBe(JSON.stringify({ key: "value" }));
    expect(state!.trailSnapshot).toBe(JSON.stringify([{ step: 1 }]));
  });

  it("setExecutionRunState with string sharedContext and trailSnapshot", async () => {
    const runId4 = crypto.randomUUID();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: runId4,
          targetType: "workflow",
          targetId: crypto.randomUUID(),
          status: "running",
        })
      )
      .run();
    await setExecutionRunState(runId4, {
      workflowId: "wf2",
      round: 0,
      sharedContext: "raw string",
      status: "waiting_for_user",
      trailSnapshot: "[]",
    });
    const state = await getExecutionRunState(runId4);
    expect(state!.sharedContext).toBe("raw string");
    expect(state!.trailSnapshot).toBe("[]");
  });

  it("setExecutionRunState update path when row exists", async () => {
    const runId5 = crypto.randomUUID();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: runId5,
          targetType: "workflow",
          targetId: crypto.randomUUID(),
          status: "running",
        })
      )
      .run();
    await setExecutionRunState(runId5, {
      workflowId: "wf",
      round: 0,
      sharedContext: "{}",
      status: "running",
      targetBranchId: "br1",
    });
    await setExecutionRunState(runId5, {
      workflowId: "wf",
      round: 1,
      sharedContext: "{}",
      status: "completed",
    });
    const state = await getExecutionRunState(runId5);
    expect(state!.round).toBe(1);
    expect(state!.status).toBe("completed");
    expect(state!.targetBranchId).toBe("br1");
  });

  it("updateExecutionRunState no-op when no row", async () => {
    await updateExecutionRunState(crypto.randomUUID(), { status: "failed" });
  });

  it("updateExecutionRunState patches only provided fields", async () => {
    const runId6 = crypto.randomUUID();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: runId6,
          targetType: "workflow",
          targetId: crypto.randomUUID(),
          status: "running",
        })
      )
      .run();
    await setExecutionRunState(runId6, {
      workflowId: "wf",
      round: 0,
      sharedContext: "{}",
      status: "running",
      waitingAtNodeId: "n1",
    });
    await updateExecutionRunState(runId6, { status: "completed", waitingAtNodeId: null });
    const state = await getExecutionRunState(runId6);
    expect(state!.status).toBe("completed");
    expect(state!.waitingAtNodeId).toBeNull();
    expect(state!.workflowId).toBe("wf");
  });

  it("parseRunStateSharedContext returns parsed object", () => {
    const state = {
      sharedContext: '{"a":1}',
    } as ExecutionRunStateRow;
    expect(parseRunStateSharedContext(state)).toEqual({ a: 1 });
  });

  it("parseRunStateSharedContext returns {} for invalid or empty", () => {
    expect(parseRunStateSharedContext({ sharedContext: "" } as ExecutionRunStateRow)).toEqual({});
    expect(
      parseRunStateSharedContext({ sharedContext: "not json" } as ExecutionRunStateRow)
    ).toEqual({});
  });
});
