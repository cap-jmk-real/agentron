import type { Workflow } from "@agentron-studio/core";

type ScheduledJob = {
  workflowId: string;
  intervalId: NodeJS.Timeout;
};

export class WorkflowScheduler {
  private jobs = new Map<string, ScheduledJob>();

  scheduleInterval(workflow: Workflow, intervalMs: number, run: () => Promise<void>) {
    this.clear(workflow.id);
    const intervalId = setInterval(() => {
      void run();
    }, intervalMs);
    this.jobs.set(workflow.id, { workflowId: workflow.id, intervalId });
  }

  clear(workflowId: string) {
    const job = this.jobs.get(workflowId);
    if (job) {
      clearInterval(job.intervalId);
      this.jobs.delete(workflowId);
    }
  }

  clearAll() {
    for (const job of this.jobs.values()) {
      clearInterval(job.intervalId);
    }
    this.jobs.clear();
  }
}
