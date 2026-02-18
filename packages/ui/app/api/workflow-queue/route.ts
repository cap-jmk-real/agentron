import { json } from "../_lib/response";
import { getWorkflowQueueStatus } from "../_lib/workflow-queue";

export const runtime = "nodejs";

/**
 * GET /api/workflow-queue
 * Returns workflow run queue status (queued count, running count, concurrency).
 * Jobs are stored in the DB; use GET /api/queues for full list.
 */
export async function GET() {
  const status = await getWorkflowQueueStatus();
  return json(status);
}
