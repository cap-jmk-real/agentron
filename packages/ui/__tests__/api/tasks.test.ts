import { describe, it, expect } from "vitest";
import { GET as listGet, POST as listPost } from "../../app/api/tasks/route";
import { GET as getOne, PATCH as patchOne } from "../../app/api/tasks/[id]/route";
import { POST as agentsPost } from "../../app/api/agents/route";
import { POST as workflowsPost } from "../../app/api/workflows/route";

describe("Tasks API", () => {
  let taskId: string;
  let workflowId: string;
  let agentId: string;

  it("GET /api/tasks returns tasks object with empty arrays when none", async () => {
    const res = await listGet(new Request("http://localhost/api/tasks"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("tasks");
    expect(data).toHaveProperty("agents");
    expect(data).toHaveProperty("workflows");
    expect(Array.isArray(data.tasks)).toBe(true);
  });

  it("POST /api/tasks creates task", async () => {
    const agentRes = await agentsPost(
      new Request("http://localhost/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Task Test Agent",
          kind: "node",
          type: "internal",
          protocol: "native",
          capabilities: [],
          scopes: [],
        }),
      })
    );
    const agentData = await agentRes.json();
    agentId = agentData.id;

    const wfRes = await workflowsPost(
      new Request("http://localhost/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Task Test Workflow",
          nodes: [],
          edges: [],
          executionMode: "manual",
        }),
      })
    );
    const wfData = await wfRes.json();
    workflowId = wfData.id;

    const res = await listPost(
      new Request("http://localhost/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowId,
          agentId,
          stepId: "step-1",
          stepName: "Approve",
          label: "Please approve",
          status: "pending_approval",
        }),
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.status).toBe("pending_approval");
    taskId = data.id;
  });

  it("GET /api/tasks?status=pending_approval returns created task", async () => {
    const res = await listGet(new Request("http://localhost/api/tasks?status=pending_approval"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tasks.some((t: { id: string }) => t.id === taskId)).toBe(true);
  });

  it("GET /api/tasks?status=approved returns empty tasks when none approved", async () => {
    const res = await listGet(new Request("http://localhost/api/tasks?status=approved"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tasks).toEqual([]);
    expect(data.agents).toEqual({});
    expect(data.workflows).toEqual({});
  });

  it("POST /api/tasks accepts optional id in body", async () => {
    const customTaskId = "custom-task-id-67890";
    const res = await listPost(
      new Request("http://localhost/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: customTaskId,
          workflowId,
          agentId,
          stepId: "step-custom-id",
          stepName: "Step",
          label: "Label",
          status: "pending_approval",
        }),
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBe(customTaskId);
  });

  it("GET /api/tasks?status=approved returns only approved tasks", async () => {
    const res = await listGet(new Request("http://localhost/api/tasks?status=approved"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.tasks)).toBe(true);
    expect(data.tasks.every((t: { status: string }) => t.status === "approved")).toBe(true);
  });

  it("POST /api/tasks accepts explicit id in body", async () => {
    const explicitId = "task-explicit-id-" + Date.now();
    const res = await listPost(
      new Request("http://localhost/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: explicitId,
          workflowId,
          agentId,
          stepId: "step-explicit",
          stepName: "Step",
          label: "Label",
          status: "pending_approval",
        }),
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBe(explicitId);
  });

  it("GET /api/tasks/:id returns task", async () => {
    const res = await getOne(new Request("http://localhost/api/tasks/x"), {
      params: Promise.resolve({ id: taskId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(taskId);
  });

  it("GET /api/tasks/:id returns 404 for unknown id", async () => {
    const res = await getOne(new Request("http://localhost/api/tasks/x"), {
      params: Promise.resolve({ id: "non-existent-task-id" }),
    });
    expect(res.status).toBe(404);
  });

  it("PATCH /api/tasks/:id approves task", async () => {
    const res = await patchOne(
      new Request("http://localhost/api/tasks/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved", output: "ok" }),
      }),
      { params: Promise.resolve({ id: taskId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("approved");
  });

  it("PATCH /api/tasks/:id approve without output keeps existing output and uses default resolvedBy", async () => {
    const resCreate = await listPost(
      new Request("http://localhost/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowId,
          agentId,
          stepId: "approve-no-out",
          stepName: "Approve",
          label: "Approve without output",
          status: "pending_approval",
        }),
      })
    );
    const created = await resCreate.json();
    const res = await patchOne(
      new Request("http://localhost/api/tasks/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      }),
      { params: Promise.resolve({ id: created.id }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("approved");
    expect(data.resolvedBy).toBe("user");
  });

  it("PATCH /api/tasks/:id rejects task with output and resolvedBy", async () => {
    const resCreate = await listPost(
      new Request("http://localhost/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowId,
          agentId,
          stepId: "reject-step",
          stepName: "Reject",
          label: "Reject this",
          status: "pending_approval",
        }),
      })
    );
    const created = await resCreate.json();
    const res = await patchOne(
      new Request("http://localhost/api/tasks/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "rejected",
          output: "not valid",
          resolvedBy: "admin",
        }),
      }),
      { params: Promise.resolve({ id: created.id }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("rejected");
    expect(data.output).toBe("not valid");
    expect(data.resolvedBy).toBe("admin");
  });

  it("PATCH /api/tasks/:id returns 404 for unknown id", async () => {
    const res = await patchOne(
      new Request("http://localhost/api/tasks/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      }),
      { params: Promise.resolve({ id: "non-existent-task-id" }) }
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Not found");
  });

  it("PATCH /api/tasks/:id returns 400 when already resolved", async () => {
    const res2 = await listPost(
      new Request("http://localhost/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowId,
          agentId,
          stepId: "step-2",
          stepName: "Approve 2",
          label: "Second",
          status: "pending_approval",
        }),
      })
    );
    const task2 = await res2.json();
    await patchOne(
      new Request("http://localhost/api/tasks/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      }),
      { params: Promise.resolve({ id: task2.id }) }
    );
    const res = await patchOne(
      new Request("http://localhost/api/tasks/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      }),
      { params: Promise.resolve({ id: task2.id }) }
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("already resolved");
  });
});
