import { describe, it, expect, vi, beforeEach } from "vitest";
import { runOneScheduledWorkflow } from "../../../app/api/_lib/run-scheduled-workflow";
import { db, executions } from "../../../app/api/_lib/db";
import { eq, desc } from "drizzle-orm";
import {
  RUN_CANCELLED_MESSAGE,
  WAITING_FOR_USER_MESSAGE,
} from "../../../app/api/_lib/run-workflow-constants";

const mockRunWorkflow = vi.fn();

vi.mock("../../../app/api/_lib/run-workflow", () => ({
  runWorkflow: (...args: unknown[]) => mockRunWorkflow(...args),
  RUN_CANCELLED_MESSAGE: "Run cancelled by user",
  WAITING_FOR_USER_MESSAGE: "WAITING_FOR_USER",
}));

vi.mock("../../../app/api/_lib/notifications-store", () => ({
  createRunNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../app/api/_lib/container-manager", () => ({
  withContainerInstallHint: (msg: string) => msg,
}));

describe("run-scheduled-workflow", () => {
  const workflowId = "scheduled-wf-" + Date.now();

  beforeEach(() => {
    mockRunWorkflow.mockReset();
  });

  async function getLatestExecutionForWorkflow(wfId: string) {
    const rows = await db
      .select()
      .from(executions)
      .where(eq(executions.targetId, wfId))
      .orderBy(desc(executions.startedAt))
      .limit(1);
    return rows[0];
  }

  it("inserts execution and on runWorkflow success sets status completed", async () => {
    mockRunWorkflow.mockResolvedValue({
      output: "done",
      context: undefined,
      trail: [],
    });
    await runOneScheduledWorkflow(workflowId);
    const row = await getLatestExecutionForWorkflow(workflowId);
    expect(row).toBeDefined();
    expect(row!.status).toBe("completed");
    expect(row!.targetType).toBe("workflow");
    expect(row!.targetId).toBe(workflowId);
  });

  it("on runWorkflow throwing WAITING_FOR_USER_MESSAGE leaves execution running", async () => {
    mockRunWorkflow.mockRejectedValueOnce(new Error(WAITING_FOR_USER_MESSAGE));
    await runOneScheduledWorkflow(workflowId);
    const row = await getLatestExecutionForWorkflow(workflowId);
    expect(row).toBeDefined();
    expect(row!.status).toBe("running");
  });

  it("on runWorkflow throwing RUN_CANCELLED_MESSAGE sets status cancelled", async () => {
    mockRunWorkflow.mockRejectedValueOnce(new Error(RUN_CANCELLED_MESSAGE));
    await runOneScheduledWorkflow(workflowId);
    const row = await getLatestExecutionForWorkflow(workflowId);
    expect(row).toBeDefined();
    expect(row!.status).toBe("cancelled");
  });

  it("on runWorkflow throwing generic error sets status failed and output", async () => {
    mockRunWorkflow.mockRejectedValueOnce(new Error("Container not found"));
    await runOneScheduledWorkflow(workflowId);
    const row = await getLatestExecutionForWorkflow(workflowId);
    expect(row).toBeDefined();
    expect(row!.status).toBe("failed");
    expect(row!.output).toBeDefined();
    const output = JSON.parse(row!.output ?? "{}");
    expect(output.error ?? output.message).toContain("Container not found");
  });

  it("accepts optional branchId", async () => {
    mockRunWorkflow.mockResolvedValue({
      output: "ok",
      context: undefined,
      trail: [],
    });
    const wfWithBranch = workflowId + "-branch";
    await runOneScheduledWorkflow(wfWithBranch, "branch-1");
    const row = await getLatestExecutionForWorkflow(wfWithBranch);
    expect(row).toBeDefined();
    expect(row!.status).toBe("completed");
  });
});
