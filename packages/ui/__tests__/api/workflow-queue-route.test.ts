import { describe, it, expect } from "vitest";
import { GET } from "../../app/api/workflow-queue/route";

describe("Workflow queue route", () => {
  it("GET /api/workflow-queue returns queue status", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual(
      expect.objectContaining({
        queued: expect.any(Number),
        running: expect.any(Number),
        concurrency: expect.any(Number),
      })
    );
  });
});
