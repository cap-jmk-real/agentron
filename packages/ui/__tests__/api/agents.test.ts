import { describe, it, expect } from "vitest";
import { GET as listGet, POST as listPost } from "../../app/api/agents/route";
import { GET as getOne, PUT as putOne, DELETE as deleteOne } from "../../app/api/agents/[id]/route";
import { GET as workflowUsageGet } from "../../app/api/agents/[id]/workflow-usage/route";
import { POST as workflowsPost } from "../../app/api/workflows/route";
import { GET as agentSkillsGet, POST as agentSkillsPost, DELETE as agentSkillsDelete } from "../../app/api/agents/[id]/skills/route";
import { POST as agentRefinePost } from "../../app/api/agents/[id]/refine/route";
import { POST as createSkill } from "../../app/api/skills/route";

describe("Agents API", () => {
  let createdId: string;

  it("GET /api/agents returns array", async () => {
    const res = await listGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("POST /api/agents creates agent", async () => {
    const res = await listPost(
      new Request("http://localhost/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Agent",
          kind: "node",
          type: "internal",
          protocol: "native",
          capabilities: [],
          scopes: [],
        }),
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.name).toBe("Test Agent");
    createdId = data.id;
  });

  it("GET /api/agents/:id returns agent", async () => {
    if (!createdId) return;
    const res = await getOne(new Request("http://localhost/api/agents/x"), { params: Promise.resolve({ id: createdId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(createdId);
    expect(data.name).toBe("Test Agent");
  });

  it("GET /api/agents/:id returns 404 for unknown id", async () => {
    const res = await getOne(new Request("http://localhost/api/agents/x"), { params: Promise.resolve({ id: "non-existent-id-12345" }) });
    expect(res.status).toBe(404);
  });

  it("PUT /api/agents/:id updates agent", async () => {
    if (!createdId) return;
    const res = await putOne(
      new Request("http://localhost/api/agents/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Updated Agent", kind: "node", type: "internal", protocol: "native", capabilities: [], scopes: [] }),
      }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("Updated Agent");
  });

  it("GET /api/agents/:id/workflow-usage returns workflows array", async () => {
    if (!createdId) return;
    const res = await workflowUsageGet(new Request("http://localhost/api/agents/x/workflow-usage"), { params: Promise.resolve({ id: createdId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.workflows)).toBe(true);
  });

  it("GET /api/agents/:id/workflow-usage returns workflows that reference this agent", async () => {
    if (!createdId) return;
    const createWf = await workflowsPost(
      new Request("http://localhost/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Uses Agent Workflow",
          nodes: [{ id: "n1", type: "agent", config: { agentId: createdId } }],
          edges: [],
          executionMode: "manual",
        }),
      })
    );
    expect(createWf.status).toBe(201);
    const wf = await createWf.json();
    const res = await workflowUsageGet(new Request("http://localhost/api/agents/x/workflow-usage"), { params: Promise.resolve({ id: createdId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.workflows.some((w: { id: string }) => w.id === wf.id)).toBe(true);
    expect(data.workflows.some((w: { name: string }) => w.name === "Uses Agent Workflow")).toBe(true);
  });

  it("POST /api/agents/:id/refine returns 404 for unknown agent", async () => {
    const res = await agentRefinePost(new Request("http://localhost/api/agents/x/refine", { method: "POST" }), {
      params: Promise.resolve({ id: "non-existent-agent-refine" }),
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Agent not found");
  });

  it("POST /api/agents/:id/refine returns 400 when agent has no feedback", async () => {
    if (!createdId) return;
    const res = await agentRefinePost(new Request("http://localhost/api/agents/x/refine", { method: "POST" }), {
      params: Promise.resolve({ id: createdId }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("feedback");
  });

  describe("GET /api/agents/:id/skills", () => {
    it("returns empty array when agent has no skills", async () => {
      if (!createdId) return;
      const res = await agentSkillsGet(new Request("http://localhost/api/agents/x/skills"), { params: Promise.resolve({ id: createdId }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(0);
    });
  });

  describe("POST /api/agents/:id/skills and DELETE", () => {
    let skillId: string;

    it("POST /api/skills creates a skill for attachment", async () => {
      const res = await createSkill(
        new Request("http://localhost/api/skills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Agent Skill", type: "prompt", content: "Help." }),
        })
      );
      expect(res.status).toBe(201);
      const data = await res.json();
      skillId = data.id;
    });

    it("POST /api/agents/:id/skills attaches skill", async () => {
      if (!createdId || !skillId) return;
      const res = await agentSkillsPost(
        new Request("http://localhost/api/agents/x/skills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skillId }),
        }),
        { params: Promise.resolve({ id: createdId }) }
      );
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.id).toBe(skillId);
      expect(data.name).toBe("Agent Skill");
    });

    it("GET /api/agents/:id/skills returns attached skills", async () => {
      if (!createdId) return;
      const res = await agentSkillsGet(new Request("http://localhost/api/agents/x/skills"), { params: Promise.resolve({ id: createdId }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThanOrEqual(1);
      expect(data.some((s: { id: string }) => s.id === skillId)).toBe(true);
    });

    it("DELETE /api/agents/:id/skills removes skill", async () => {
      if (!createdId || !skillId) return;
      const res = await agentSkillsDelete(
        new Request("http://localhost/api/agents/x/skills", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skillId }),
        }),
        { params: Promise.resolve({ id: createdId }) }
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
    });

    it("POST /api/agents/:id/skills returns 400 when body missing skillId", async () => {
      if (!createdId) return;
      const res = await agentSkillsPost(
        new Request("http://localhost/api/agents/x/skills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
        { params: Promise.resolve({ id: createdId }) }
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBeDefined();
    });

    it("POST /api/agents/:id/skills returns 400 for invalid JSON body", async () => {
      if (!createdId) return;
      const res = await agentSkillsPost(
        new Request("http://localhost/api/agents/x/skills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "not valid json",
        }),
        { params: Promise.resolve({ id: createdId }) }
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBeDefined();
    });

    it("DELETE /api/agents/:id/skills returns 400 for invalid JSON body", async () => {
      if (!createdId) return;
      const res = await agentSkillsDelete(
        new Request("http://localhost/api/agents/x/skills", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: "not valid json",
        }),
        { params: Promise.resolve({ id: createdId }) }
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBeDefined();
    });
  });

  it("DELETE /api/agents/:id removes agent", async () => {
    if (!createdId) return;
    const res = await deleteOne(new Request("http://localhost/api/agents/x", { method: "DELETE" }), { params: Promise.resolve({ id: createdId }) });
    expect(res.status).toBe(200);
    const getRes = await getOne(new Request("http://localhost/api/agents/x"), { params: Promise.resolve({ id: createdId }) });
    expect(getRes.status).toBe(404);
  });
});
