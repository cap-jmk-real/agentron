import { describe, it, expect } from "vitest";
import {
  enqueueWorkflowStart,
  enqueueWorkflowResume,
  enqueueScheduledWorkflow,
  getWorkflowQueueJob,
  getWorkflowQueueStatus,
  listWorkflowQueueJobs,
} from "../../../app/api/_lib/workflow-queue";

describe("workflow-queue", () => {
  it("enqueueWorkflowStart returns job id and job is readable", async () => {
    const runId = crypto.randomUUID();
    const workflowId = "wf-1";
    const jobId = await enqueueWorkflowStart({ runId, workflowId });
    expect(typeof jobId).toBe("string");
    expect(jobId.length).toBeGreaterThan(0);
    const job = await getWorkflowQueueJob(jobId);
    expect(job).not.toBeNull();
    expect(job!.id).toBe(jobId);
    expect(job!.type).toBe("workflow_start");
    expect(job!.status).toBe("queued");
    expect(job!.runId).toBe(runId);
  });

  it("enqueueWorkflowResume returns job id", async () => {
    const runId = crypto.randomUUID();
    const jobId = await enqueueWorkflowResume({ runId, resumeUserResponse: "ok" });
    expect(typeof jobId).toBe("string");
    const job = await getWorkflowQueueJob(jobId);
    expect(job?.type).toBe("workflow_resume");
    expect(job?.status).toBe("queued");
  });

  it("enqueueScheduledWorkflow returns job id", async () => {
    const jobId = await enqueueScheduledWorkflow({ workflowId: "wf-2", branchId: "br-1" });
    expect(typeof jobId).toBe("string");
    const job = await getWorkflowQueueJob(jobId);
    expect(job?.type).toBe("scheduled");
    expect(job?.runId).toBeNull();
  });

  it("getWorkflowQueueStatus returns queued/running/concurrency", async () => {
    const status = await getWorkflowQueueStatus();
    expect(status).toEqual(
      expect.objectContaining({
        queued: expect.any(Number),
        running: expect.any(Number),
        concurrency: 2,
      })
    );
  });

  it("listWorkflowQueueJobs returns array with limit", async () => {
    const jobs = await listWorkflowQueueJobs({ limit: 10 });
    expect(Array.isArray(jobs)).toBe(true);
    jobs.forEach((j) => {
      expect(j).toHaveProperty("id");
      expect(j).toHaveProperty("type");
      expect(j).toHaveProperty("status");
      expect(j).toHaveProperty("createdAt");
    });
  });

  it("listWorkflowQueueJobs filters by status when opts.status provided", async () => {
    const jobs = await listWorkflowQueueJobs({ status: "queued", limit: 5 });
    expect(Array.isArray(jobs)).toBe(true);
    jobs.forEach((j) => expect(j.status).toBe("queued"));
  });

  it("getWorkflowQueueJob returns null for unknown job id", async () => {
    const job = await getWorkflowQueueJob("non-existent-job-id-12345");
    expect(job).toBeNull();
  });
});
