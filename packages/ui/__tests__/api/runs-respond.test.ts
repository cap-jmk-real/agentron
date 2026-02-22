import { describe, it, expect, beforeAll, vi } from "vitest";
import { POST } from "../../app/api/runs/[id]/respond/route";
import { db, executions, runLogs, toExecutionRow } from "../../app/api/_lib/db";
import { eq } from "drizzle-orm";

vi.mock("../../app/api/_lib/workflow-queue", () => ({
  enqueueWorkflowResume: vi.fn().mockResolvedValue("job-resume-1"),
}));

describe("Runs [id] respond API", () => {
  let waitingRunId: string;
  let runningRunId: string;

  beforeAll(async () => {
    waitingRunId = crypto.randomUUID();
    runningRunId = crypto.randomUUID();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: waitingRunId,
          targetType: "agent",
          targetId: crypto.randomUUID(),
          status: "waiting_for_user",
          output: { question: "Confirm?", options: ["Yes", "No"] },
        })
      )
      .run();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: runningRunId,
          targetType: "agent",
          targetId: crypto.randomUUID(),
          status: "running",
        })
      )
      .run();
  });

  it("POST /api/runs/:id/respond returns 404 for unknown run", async () => {
    const res = await POST(
      new Request("http://localhost/api/runs/unknown-id/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: "Yes" }),
      }),
      { params: Promise.resolve({ id: "unknown-id" }) }
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Not found");
  });

  it("POST /api/runs/:id/respond returns 400 when run is not waiting_for_user", async () => {
    const res = await POST(
      new Request(`http://localhost/api/runs/${runningRunId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: "Yes" }),
      }),
      { params: Promise.resolve({ id: runningRunId }) }
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Run is not waiting for user input");
    expect(data.status).toBe("running");
  });

  it("POST /api/runs/:id/respond returns 400 for invalid JSON body", async () => {
    const res = await POST(
      new Request(`http://localhost/api/runs/${waitingRunId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      }),
      { params: Promise.resolve({ id: waitingRunId }) }
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid JSON body");
  });

  it("POST /api/runs/:id/respond returns 200 and updates run with response", async () => {
    const res = await POST(
      new Request(`http://localhost/api/runs/${waitingRunId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: "Yes" }),
      }),
      { params: Promise.resolve({ id: waitingRunId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(waitingRunId);
    expect(data.status).toBe("running");
    expect(data.output).toBeDefined();
    const output = typeof data.output === "string" ? JSON.parse(data.output) : data.output;
    expect(output.output?.userResponded).toBe(true);
    expect(output.output?.response).toBe("Yes");
  });

  it("POST /api/runs/:id/respond with empty response uses (no text)", async () => {
    const emptyRunId = crypto.randomUUID();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: emptyRunId,
          targetType: "agent",
          targetId: crypto.randomUUID(),
          status: "waiting_for_user",
          output: { question: "Reply?" },
        })
      )
      .run();
    const res = await POST(
      new Request(`http://localhost/api/runs/${emptyRunId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: emptyRunId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    const output = typeof data.output === "string" ? JSON.parse(data.output) : data.output;
    expect(output.output?.response).toBe("(no text)");
  });

  it("POST /api/runs/:id/respond with response over 80 chars truncates reply in log", async () => {
    const longRunId = crypto.randomUUID();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: longRunId,
          targetType: "agent",
          targetId: crypto.randomUUID(),
          status: "waiting_for_user",
          output: {},
        })
      )
      .run();
    const longResponse = "x".repeat(90);
    const res = await POST(
      new Request(`http://localhost/api/runs/${longRunId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: longResponse }),
      }),
      { params: Promise.resolve({ id: longRunId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    const output = typeof data.output === "string" ? JSON.parse(data.output) : data.output;
    expect(output.output?.response).toBe(longResponse);
    const logs = await db.select().from(runLogs).where(eq(runLogs.executionId, longRunId));
    const replyLog = logs.find((l) => l.message?.includes("User replied"));
    expect(replyLog?.message).toContain("x".repeat(77) + "…");
  });
});
