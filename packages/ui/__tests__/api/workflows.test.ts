import { describe, it, expect, vi } from "vitest";
import { GET as listGet, POST as listPost } from "../../app/api/workflows/route";
import {
  GET as getOne,
  PUT as putOne,
  DELETE as deleteOne,
} from "../../app/api/workflows/[id]/route";
import { POST as executePost } from "../../app/api/workflows/[id]/execute/route";
import { GET as versionsGet } from "../../app/api/workflows/[id]/versions/route";
import { POST as rollbackPost } from "../../app/api/workflows/[id]/rollback/route";
import { db, workflows, workflowVersions } from "../../app/api/_lib/db";
import { eq } from "drizzle-orm";
import * as workflowQueue from "../../app/api/_lib/workflow-queue";
import {
  WaitingForUserError,
  WAITING_FOR_USER_MESSAGE,
  RUN_CANCELLED_MESSAGE,
} from "../../app/api/_lib/run-workflow";

vi.mock("../../app/api/_lib/workflow-queue", () => ({
  enqueueWorkflowStart: vi.fn().mockResolvedValue("job-1"),
  waitForJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../app/api/_lib/vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../app/api/_lib/vault")>();
  return {
    ...actual,
    getVaultKeyFromRequest: vi.fn().mockReturnValue(Buffer.from("test-vault-key")),
  };
});

describe("Workflows API", () => {
  let createdId: string;

  it("GET /api/workflows returns array", async () => {
    const res = await listGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("POST /api/workflows creates workflow", async () => {
    const res = await listPost(
      new Request("http://localhost/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Workflow",
          nodes: [],
          edges: [],
          executionMode: "manual",
        }),
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.name).toBe("Test Workflow");
    createdId = data.id;
  });

  it("POST /api/workflows uses random name when name missing or empty", async () => {
    const res = await listPost(
      new Request("http://localhost/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodes: [],
          edges: [],
          executionMode: "manual",
        }),
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.name).toBeDefined();
    expect(typeof data.name).toBe("string");
    expect(data.name.length).toBeGreaterThan(0);
  });

  it("GET /api/workflows/:id returns workflow", async () => {
    if (!createdId) return;
    const res = await getOne(new Request("http://localhost/api/workflows/x"), {
      params: Promise.resolve({ id: createdId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(createdId);
    expect(data.name).toBe("Test Workflow");
  });

  it("GET /api/workflows/:id returns 404 for unknown id", async () => {
    const res = await getOne(new Request("http://localhost/api/workflows/x"), {
      params: Promise.resolve({ id: "non-existent-workflow-id" }),
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Not found");
  });

  it("PUT /api/workflows/:id updates workflow", async () => {
    if (!createdId) return;
    const res = await putOne(
      new Request("http://localhost/api/workflows/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Updated Workflow",
          nodes: [],
          edges: [],
          executionMode: "manual",
        }),
      }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("Updated Workflow");
  });

  it("POST /api/workflows/:id/execute returns run with status", async () => {
    if (!createdId) return;
    const res = await executePost(
      new Request("http://localhost/api/workflows/x/execute", { method: "POST" }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.targetType).toBe("workflow");
    expect(data.targetId).toBe(createdId);
    expect(["running", "completed", "failed", "cancelled"]).toContain(data.status);
  });

  it("POST /api/workflows/:id/execute uses default maxSelfFixRetries when body has NaN", async () => {
    if (!createdId) return;
    const res = await executePost(
      new Request("http://localhost/api/workflows/x/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxSelfFixRetries: Number.NaN }),
      }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBeDefined();
  });

  it("POST /api/workflows/:id/execute accepts body with maxSelfFixRetries", async () => {
    if (!createdId) return;
    const res = await executePost(
      new Request("http://localhost/api/workflows/x/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxSelfFixRetries: 3 }),
      }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.targetType).toBe("workflow");
  });

  it("POST /api/workflows/:id/execute uses default maxSelfFixRetries when body is invalid JSON", async () => {
    if (!createdId) return;
    const res = await executePost(
      new Request("http://localhost/api/workflows/x/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.targetType).toBe("workflow");
  });

  it("POST /api/workflows/:id/execute accepts maxSelfFixRetries 0", async () => {
    if (!createdId) return;
    const res = await executePost(
      new Request("http://localhost/api/workflows/x/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxSelfFixRetries: 0 }),
      }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBeDefined();
  });

  it("POST /api/workflows/:id/execute clamps maxSelfFixRetries to 0-10", async () => {
    if (!createdId) return;
    const res = await executePost(
      new Request("http://localhost/api/workflows/x/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxSelfFixRetries: 15 }),
      }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBeDefined();
  });

  it("POST /api/workflows/:id/execute returns 200 with output.trail when waitForJob throws WaitingForUserError", async () => {
    if (!createdId) return;
    const trail = [{ nodeId: "n1", agentId: "a1", agentName: "Agent", order: 0 }];
    (workflowQueue.waitForJob as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new WaitingForUserError(WAITING_FOR_USER_MESSAGE, trail)
    );
    const res = await executePost(
      new Request("http://localhost/api/workflows/x/execute", { method: "POST" }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    const output = typeof data.output === "string" ? JSON.parse(data.output) : data.output;
    expect(output).toHaveProperty("trail");
    expect(output.trail).toEqual(trail);
  });

  it("POST /api/workflows/:id/execute returns 200 and status cancelled when waitForJob throws RUN_CANCELLED_MESSAGE", async () => {
    if (!createdId) return;
    (workflowQueue.waitForJob as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error(RUN_CANCELLED_MESSAGE)
    );
    const res = await executePost(
      new Request("http://localhost/api/workflows/x/execute", { method: "POST" }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("cancelled");
  });

  it("POST /api/workflows/:id/execute returns 200 and status failed when waitForJob throws generic error", async () => {
    if (!createdId) return;
    (workflowQueue.waitForJob as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Container not found")
    );
    const res = await executePost(
      new Request("http://localhost/api/workflows/x/execute", { method: "POST" }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("failed");
    expect(data.output).toBeDefined();
  });

  describe("versions", () => {
    it("GET /api/workflows/:id/versions returns 404 for unknown workflow", async () => {
      const res = await versionsGet(new Request("http://localhost/api/workflows/x"), {
        params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
      });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe("Workflow not found");
    });

    it("GET /api/workflows/:id/versions returns empty array when no versions", async () => {
      if (!createdId) return;
      const res = await versionsGet(new Request("http://localhost/api/workflows/x"), {
        params: Promise.resolve({ id: createdId }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(0);
    });

    it("GET /api/workflows/:id/versions returns version list when versions exist", async () => {
      if (!createdId) return;
      const versionId = crypto.randomUUID();
      const wfRows = await db.select().from(workflows).where(eq(workflows.id, createdId));
      expect(wfRows.length).toBe(1);
      const row = wfRows[0]!;
      const snapshot = JSON.stringify({
        id: row.id,
        name: row.name,
        description: row.description,
        nodes: row.nodes,
        edges: row.edges,
        executionMode: row.executionMode,
        schedule: row.schedule,
        maxRounds: row.maxRounds,
        turnInstruction: row.turnInstruction,
        branches: row.branches,
        executionOrder: row.executionOrder,
        createdAt: row.createdAt,
      });
      await db
        .insert(workflowVersions)
        .values({
          id: versionId,
          workflowId: createdId,
          version: 1,
          snapshot,
          createdAt: Date.now(),
          conversationId: null,
        })
        .run();
      const res = await versionsGet(new Request("http://localhost/api/workflows/x"), {
        params: Promise.resolve({ id: createdId }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(1);
      expect(data[0].id).toBe(versionId);
      expect(data[0].version).toBe(1);
      expect(typeof data[0].created_at).toBe("number");
    });
  });

  describe("rollback", () => {
    it("POST /api/workflows/:id/rollback returns 404 when workflow not found", async () => {
      const res = await rollbackPost(
        new Request("http://localhost/api/workflows/x/rollback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ versionId: "some-version-id" }),
        }),
        { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) }
      );
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe("Workflow not found");
    });

    it("POST /api/workflows/:id/rollback returns 404 when version not found", async () => {
      if (!createdId) return;
      const res = await rollbackPost(
        new Request("http://localhost/api/workflows/x/rollback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ versionId: "00000000-0000-0000-0000-000000000000" }),
        }),
        { params: Promise.resolve({ id: createdId }) }
      );
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain("Version not found");
    });

    it("POST /api/workflows/:id/rollback returns 404 when version number does not exist", async () => {
      if (!createdId) return;
      const res = await rollbackPost(
        new Request("http://localhost/api/workflows/x/rollback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version: 999 }),
        }),
        { params: Promise.resolve({ id: createdId }) }
      );
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain("Version not found");
    });

    it("POST /api/workflows/:id/rollback returns 404 when versionId belongs to another workflow", async () => {
      if (!createdId) return;
      const otherWfRes = await listPost(
        new Request("http://localhost/api/workflows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Other Workflow",
            nodes: [],
            edges: [],
            executionMode: "manual",
          }),
        })
      );
      const otherWf = await otherWfRes.json();
      const versionId = crypto.randomUUID();
      const otherRow = (await db.select().from(workflows).where(eq(workflows.id, otherWf.id)))[0]!;
      const snapshot = JSON.stringify({
        id: otherWf.id,
        name: otherRow.name,
        nodes: otherRow.nodes,
        edges: otherRow.edges,
        executionMode: otherRow.executionMode,
        createdAt: otherRow.createdAt,
      });
      await db
        .insert(workflowVersions)
        .values({
          id: versionId,
          workflowId: otherWf.id,
          version: 1,
          snapshot,
          createdAt: Date.now(),
          conversationId: null,
        })
        .run();
      const res = await rollbackPost(
        new Request("http://localhost/api/workflows/x/rollback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ versionId }),
        }),
        { params: Promise.resolve({ id: createdId }) }
      );
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain("Version not found");
    });

    it("POST /api/workflows/:id/rollback restores workflow from version by versionId", async () => {
      if (!createdId) return;
      const wfRows = await db.select().from(workflows).where(eq(workflows.id, createdId));
      expect(wfRows.length).toBe(1);
      const row = wfRows[0]!;
      const versionId = crypto.randomUUID();
      const snapshot = JSON.stringify({
        id: row.id,
        name: "Rolled back name",
        description: row.description,
        nodes: row.nodes,
        edges: row.edges,
        executionMode: row.executionMode,
        schedule: row.schedule,
        maxRounds: row.maxRounds,
        turnInstruction: row.turnInstruction,
        branches: row.branches,
        executionOrder: row.executionOrder,
        createdAt: row.createdAt,
      });
      await db
        .insert(workflowVersions)
        .values({
          id: versionId,
          workflowId: createdId,
          version: 1,
          snapshot,
          createdAt: Date.now(),
          conversationId: null,
        })
        .run();
      const res = await rollbackPost(
        new Request("http://localhost/api/workflows/x/rollback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ versionId }),
        }),
        { params: Promise.resolve({ id: createdId }) }
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.id).toBe(createdId);
      expect(data.version).toBe(1);
      expect(data.message).toContain("rolled back");
      const getRes = await getOne(new Request("http://localhost/api/workflows/x"), {
        params: Promise.resolve({ id: createdId }),
      });
      expect(getRes.status).toBe(200);
      const wf = await getRes.json();
      expect(wf.name).toBe("Rolled back name");
    });

    it("POST /api/workflows/:id/rollback restores workflow from version by version number", async () => {
      if (!createdId) return;
      const wfRows = await db.select().from(workflows).where(eq(workflows.id, createdId));
      expect(wfRows.length).toBe(1);
      const row = wfRows[0]!;
      const versionId = crypto.randomUUID();
      const snapshot = JSON.stringify({
        id: row.id,
        name: "Rolled back by version num",
        description: row.description,
        nodes: row.nodes,
        edges: row.edges,
        executionMode: row.executionMode,
        schedule: row.schedule,
        maxRounds: row.maxRounds,
        turnInstruction: row.turnInstruction,
        branches: row.branches,
        executionOrder: row.executionOrder,
        createdAt: row.createdAt,
      });
      await db
        .insert(workflowVersions)
        .values({
          id: versionId,
          workflowId: createdId,
          version: 2,
          snapshot,
          createdAt: Date.now(),
          conversationId: null,
        })
        .run();
      const res = await rollbackPost(
        new Request("http://localhost/api/workflows/x/rollback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version: 2 }),
        }),
        { params: Promise.resolve({ id: createdId }) }
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.version).toBe(2);
      const getRes = await getOne(new Request("http://localhost/api/workflows/x"), {
        params: Promise.resolve({ id: createdId }),
      });
      const wf = await getRes.json();
      expect(wf.name).toBe("Rolled back by version num");
    });

    it("POST /api/workflows/:id/rollback returns 400 when snapshot does not match workflow", async () => {
      if (!createdId) return;
      const versionId = crypto.randomUUID();
      const wrongId = "00000000-0000-0000-0000-000000000001";
      await db
        .insert(workflowVersions)
        .values({
          id: versionId,
          workflowId: createdId,
          version: 1,
          snapshot: JSON.stringify({
            id: wrongId,
            name: "Other",
            description: null,
            nodes: "[]",
            edges: "[]",
            executionMode: "manual",
            schedule: null,
            maxRounds: null,
            turnInstruction: null,
            branches: null,
            executionOrder: null,
            createdAt: Date.now(),
          }),
          createdAt: Date.now(),
          conversationId: null,
        })
        .run();
      const res = await rollbackPost(
        new Request("http://localhost/api/workflows/x/rollback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ versionId }),
        }),
        { params: Promise.resolve({ id: createdId }) }
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Snapshot does not match");
    });

    it("POST /api/workflows/:id/rollback returns 500 when snapshot is invalid JSON", async () => {
      if (!createdId) return;
      const versionId = crypto.randomUUID();
      await db
        .insert(workflowVersions)
        .values({
          id: versionId,
          workflowId: createdId,
          version: 1,
          snapshot: "not valid json {",
          createdAt: Date.now(),
          conversationId: null,
        })
        .run();
      const res = await rollbackPost(
        new Request("http://localhost/api/workflows/x/rollback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ versionId }),
        }),
        { params: Promise.resolve({ id: createdId }) }
      );
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe("Invalid snapshot");
    });
  });

  it("DELETE /api/workflows/:id removes workflow", async () => {
    if (!createdId) return;
    const res = await deleteOne(
      new Request("http://localhost/api/workflows/x", { method: "DELETE" }),
      {
        params: Promise.resolve({ id: createdId }),
      }
    );
    expect(res.status).toBe(200);
    const getRes = await getOne(new Request("http://localhost/api/workflows/x"), {
      params: Promise.resolve({ id: createdId }),
    });
    expect(getRes.status).toBe(404);
  });
});
