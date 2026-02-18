import { describe, it, expect } from "vitest";
import { GET } from "../../app/api/queues/route";

describe("Queues API", () => {
  it("GET /api/queues returns workflowQueue and conversationLocks", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("workflowQueue");
    expect(data.workflowQueue).toHaveProperty("status");
    expect(data.workflowQueue.status).toEqual(
      expect.objectContaining({
        queued: expect.any(Number),
        running: expect.any(Number),
        concurrency: expect.any(Number),
      })
    );
    expect(data.workflowQueue).toHaveProperty("jobs");
    expect(Array.isArray(data.workflowQueue.jobs)).toBe(true);
    expect(data).toHaveProperty("conversationLocks");
    expect(Array.isArray(data.conversationLocks)).toBe(true);
  });
});
