import { json } from "../_lib/response";
import { db, conversationLocks } from "../_lib/db";
import {
  getWorkflowQueueStatus,
  listWorkflowQueueJobs,
  type WorkflowQueueJobRow,
} from "../_lib/workflow-queue";

export const runtime = "nodejs";

export type QueuesResponse = {
  workflowQueue: {
    status: { queued: number; running: number; concurrency: number };
    jobs: WorkflowQueueJobRow[];
  };
  conversationLocks: Array<{ conversationId: string; startedAt: number; createdAt: number }>;
};

/**
 * GET /api/queues
 * Returns all queue-related state: workflow queue (status + jobs) and active conversation locks.
 */
export async function GET() {
  const [status, jobs, lockRows] = await Promise.all([
    getWorkflowQueueStatus(),
    listWorkflowQueueJobs({ limit: 100 }),
    db.select().from(conversationLocks),
  ]);

  const response: QueuesResponse = {
    workflowQueue: { status, jobs },
    conversationLocks: lockRows.map((r) => ({
      conversationId: r.conversationId,
      startedAt: r.startedAt,
      createdAt: r.createdAt,
    })),
  };
  return json(response);
}
