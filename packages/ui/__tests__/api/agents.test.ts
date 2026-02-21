import { describe, it, expect } from "vitest";
import { GET as listGet, POST as listPost } from "../../app/api/agents/route";
import { GET as getOne, PUT as putOne, DELETE as deleteOne } from "../../app/api/agents/[id]/route";
import { GET as workflowUsageGet } from "../../app/api/agents/[id]/workflow-usage/route";
import { GET as agentVersionsGet } from "../../app/api/agents/[id]/versions/route";
import { POST as agentRollbackPost } from "../../app/api/agents/[id]/rollback/route";
import { POST as workflowsPost } from "../../app/api/workflows/route";
import {
  GET as agentSkillsGet,
  POST as agentSkillsPost,
  DELETE as agentSkillsDelete,
} from "../../app/api/agents/[id]/skills/route";
import { POST as agentRefinePost } from "../../app/api/agents/[id]/refine/route";
import { POST as createSkill } from "../../app/api/skills/route";
import { db, agents, agentVersions } from "../../app/api/_lib/db";
import { eq } from "drizzle-orm";

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
    const res = await getOne(new Request("http://localhost/api/agents/x"), {
      params: Promise.resolve({ id: createdId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(createdId);
    expect(data.name).toBe("Test Agent");
  });

  it("GET /api/agents/:id returns 404 for unknown id", async () => {
    const res = await getOne(new Request("http://localhost/api/agents/x"), {
      params: Promise.resolve({ id: "non-existent-id-12345" }),
    });
    expect(res.status).toBe(404);
  });

  it("PUT /api/agents/:id updates agent", async () => {
    if (!createdId) return;
    const res = await putOne(
      new Request("http://localhost/api/agents/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Updated Agent",
          kind: "node",
          type: "internal",
          protocol: "native",
          capabilities: [],
          scopes: [],
        }),
      }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("Updated Agent");
  });

  it("PUT /api/agents/:id syncs toolIds from graph nodes", async () => {
    if (!createdId) return;
    const res = await putOne(
      new Request("http://localhost/api/agents/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Graph Agent",
          kind: "node",
          type: "internal",
          protocol: "native",
          capabilities: [],
          scopes: [],
          definition: {
            toolIds: ["existing-tool"],
            graph: {
              nodes: [
                { type: "tool", parameters: { toolId: "from-graph-1" } },
                { type: "other" },
                { type: "tool", parameters: { toolId: "  from-graph-2  " } },
              ],
            },
          },
        }),
      }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.definition).toBeDefined();
    const toolIds = data.definition?.toolIds as string[] | undefined;
    expect(Array.isArray(toolIds)).toBe(true);
    expect(toolIds).toContain("existing-tool");
    expect(toolIds).toContain("from-graph-1");
    expect(toolIds).toContain("from-graph-2");
  });

  it("GET /api/agents/:id/workflow-usage returns workflows array", async () => {
    if (!createdId) return;
    const res = await workflowUsageGet(
      new Request("http://localhost/api/agents/x/workflow-usage"),
      { params: Promise.resolve({ id: createdId }) }
    );
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
    const res = await workflowUsageGet(
      new Request("http://localhost/api/agents/x/workflow-usage"),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.workflows.some((w: { id: string }) => w.id === wf.id)).toBe(true);
    expect(data.workflows.some((w: { name: string }) => w.name === "Uses Agent Workflow")).toBe(
      true
    );
  });

  it("POST /api/agents/:id/refine returns 404 for unknown agent", async () => {
    const res = await agentRefinePost(
      new Request("http://localhost/api/agents/x/refine", { method: "POST" }),
      {
        params: Promise.resolve({ id: "non-existent-agent-refine" }),
      }
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Agent not found");
  });

  it("POST /api/agents/:id/refine returns 400 when agent has no feedback", async () => {
    if (!createdId) return;
    const res = await agentRefinePost(
      new Request("http://localhost/api/agents/x/refine", { method: "POST" }),
      {
        params: Promise.resolve({ id: createdId }),
      }
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("feedback");
  });

  describe("GET /api/agents/:id/skills", () => {
    it("returns empty array when agent has no skills", async () => {
      if (!createdId) return;
      const res = await agentSkillsGet(new Request("http://localhost/api/agents/x/skills"), {
        params: Promise.resolve({ id: createdId }),
      });
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
      const res = await agentSkillsGet(new Request("http://localhost/api/agents/x/skills"), {
        params: Promise.resolve({ id: createdId }),
      });
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

    it("DELETE /api/agents/:id/skills returns 400 when body missing skillId", async () => {
      if (!createdId) return;
      const res = await agentSkillsDelete(
        new Request("http://localhost/api/agents/x/skills", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
        { params: Promise.resolve({ id: createdId }) }
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("skillId");
    });

    it("POST /api/agents/:id/skills returns 404 when skill not found", async () => {
      if (!createdId) return;
      const res = await agentSkillsPost(
        new Request("http://localhost/api/agents/x/skills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skillId: "non-existent-skill-id" }),
        }),
        { params: Promise.resolve({ id: createdId }) }
      );
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain("Skill not found");
    });

    it("POST /api/agents/:id/skills returns 409 when skill already attached", async () => {
      if (!createdId) return;
      const skillRes = await createSkill(
        new Request("http://localhost/api/skills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Duplicate Skill", type: "prompt" }),
        })
      );
      const skill = await skillRes.json();
      await agentSkillsPost(
        new Request("http://localhost/api/agents/x/skills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skillId: skill.id }),
        }),
        { params: Promise.resolve({ id: createdId }) }
      );
      const res = await agentSkillsPost(
        new Request("http://localhost/api/agents/x/skills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skillId: skill.id }),
        }),
        { params: Promise.resolve({ id: createdId }) }
      );
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toContain("already attached");
    });
  });

  describe("versions", () => {
    it("GET /api/agents/:id/versions returns 404 for unknown agent", async () => {
      const res = await agentVersionsGet(new Request("http://localhost/api/agents/x"), {
        params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
      });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe("Agent not found");
    });

    it("GET /api/agents/:id/versions returns empty array when no versions", async () => {
      if (!createdId) return;
      const res = await agentVersionsGet(new Request("http://localhost/api/agents/x"), {
        params: Promise.resolve({ id: createdId }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(0);
    });

    it("GET /api/agents/:id/versions returns version list when versions exist", async () => {
      if (!createdId) return;
      const agentRows = await db.select().from(agents).where(eq(agents.id, createdId));
      expect(agentRows.length).toBe(1);
      const row = agentRows[0]!;
      const versionId = crypto.randomUUID();
      const snapshot = JSON.stringify({
        id: row.id,
        name: row.name,
        description: row.description,
        kind: row.kind,
        type: row.type,
        protocol: row.protocol,
        endpoint: row.endpoint,
        agentKey: row.agentKey,
        capabilities: row.capabilities,
        scopes: row.scopes,
        llmConfig: row.llmConfig,
        definition: row.definition,
        createdAt: row.createdAt,
      });
      await db
        .insert(agentVersions)
        .values({
          id: versionId,
          agentId: createdId,
          version: 1,
          snapshot,
          createdAt: Date.now(),
          conversationId: null,
        })
        .run();
      const res = await agentVersionsGet(new Request("http://localhost/api/agents/x"), {
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
    it("POST /api/agents/:id/rollback returns 404 when agent not found", async () => {
      const res = await agentRollbackPost(
        new Request("http://localhost/api/agents/x/rollback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ versionId: "some-version-id" }),
        }),
        { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) }
      );
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe("Agent not found");
    });

    it("POST /api/agents/:id/rollback returns 404 when version not found", async () => {
      if (!createdId) return;
      const res = await agentRollbackPost(
        new Request("http://localhost/api/agents/x/rollback", {
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

    it("POST /api/agents/:id/rollback returns 404 when versionId belongs to another agent", async () => {
      if (!createdId) return;
      const otherRes = await listPost(
        new Request("http://localhost/api/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Other Agent",
            kind: "node",
            type: "internal",
            protocol: "native",
            capabilities: [],
            scopes: [],
          }),
        })
      );
      const other = await otherRes.json();
      const versionId = crypto.randomUUID();
      const otherRows = await db.select().from(agents).where(eq(agents.id, other.id));
      const row = otherRows[0]!;
      await db
        .insert(agentVersions)
        .values({
          id: versionId,
          agentId: other.id,
          version: 1,
          snapshot: JSON.stringify({
            id: row.id,
            name: row.name,
            description: row.description,
            kind: row.kind,
            type: row.type,
            protocol: row.protocol,
            endpoint: row.endpoint,
            agentKey: row.agentKey,
            capabilities: row.capabilities,
            scopes: row.scopes,
            llmConfig: row.llmConfig,
            definition: row.definition,
            createdAt: row.createdAt,
          }),
          createdAt: Date.now(),
          conversationId: null,
        })
        .run();
      const res = await agentRollbackPost(
        new Request("http://localhost/api/agents/x/rollback", {
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

    it("POST /api/agents/:id/rollback restores agent from version by versionId", async () => {
      if (!createdId) return;
      const agentRows = await db.select().from(agents).where(eq(agents.id, createdId));
      expect(agentRows.length).toBe(1);
      const row = agentRows[0]!;
      const versionId = crypto.randomUUID();
      const snapshot = JSON.stringify({
        id: row.id,
        name: "Rolled back agent name",
        description: row.description,
        kind: row.kind,
        type: row.type,
        protocol: row.protocol,
        endpoint: row.endpoint,
        agentKey: row.agentKey,
        capabilities: row.capabilities,
        scopes: row.scopes,
        llmConfig: row.llmConfig,
        definition: row.definition,
        createdAt: row.createdAt,
      });
      await db
        .insert(agentVersions)
        .values({
          id: versionId,
          agentId: createdId,
          version: 1,
          snapshot,
          createdAt: Date.now(),
          conversationId: null,
        })
        .run();
      const res = await agentRollbackPost(
        new Request("http://localhost/api/agents/x/rollback", {
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
      const getRes = await getOne(new Request("http://localhost/api/agents/x"), {
        params: Promise.resolve({ id: createdId }),
      });
      expect(getRes.status).toBe(200);
      const agent = await getRes.json();
      expect(agent.name).toBe("Rolled back agent name");
    });

    it("POST /api/agents/:id/rollback returns 400 when snapshot does not match agent", async () => {
      if (!createdId) return;
      const versionId = crypto.randomUUID();
      const agentRows = await db.select().from(agents).where(eq(agents.id, createdId));
      const row = agentRows[0]!;
      await db
        .insert(agentVersions)
        .values({
          id: versionId,
          agentId: createdId,
          version: 1,
          snapshot: JSON.stringify({
            id: "00000000-0000-0000-0000-000000000001",
            name: "Other",
            description: row.description,
            kind: row.kind,
            type: row.type,
            protocol: row.protocol,
            endpoint: row.endpoint,
            agentKey: row.agentKey,
            capabilities: row.capabilities,
            scopes: row.scopes,
            llmConfig: row.llmConfig,
            definition: row.definition,
            createdAt: row.createdAt,
          }),
          createdAt: Date.now(),
          conversationId: null,
        })
        .run();
      const res = await agentRollbackPost(
        new Request("http://localhost/api/agents/x/rollback", {
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

    it("POST /api/agents/:id/rollback returns 500 when snapshot is invalid JSON", async () => {
      if (!createdId) return;
      const versionId = crypto.randomUUID();
      await db
        .insert(agentVersions)
        .values({
          id: versionId,
          agentId: createdId,
          version: 1,
          snapshot: "not valid json {",
          createdAt: Date.now(),
          conversationId: null,
        })
        .run();
      const res = await agentRollbackPost(
        new Request("http://localhost/api/agents/x/rollback", {
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

  it("DELETE /api/agents/:id removes agent", async () => {
    if (!createdId) return;
    const res = await deleteOne(
      new Request("http://localhost/api/agents/x", { method: "DELETE" }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    const getRes = await getOne(new Request("http://localhost/api/agents/x"), {
      params: Promise.resolve({ id: createdId }),
    });
    expect(getRes.status).toBe(404);
  });
});
