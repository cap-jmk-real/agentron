import { describe, it, expect } from "vitest";
import { POST } from "../../app/api/import/route";
import { GET as agentsGet } from "../../app/api/agents/route";
import { GET as workflowsGet } from "../../app/api/workflows/route";
import { GET as toolsGet } from "../../app/api/tools/route";

describe("Import API", () => {
  it("POST /api/import returns 400 for invalid JSON", async () => {
    const res = await POST(
      new Request("http://localhost/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not valid json",
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("POST /api/import with empty body returns ok and zero counts", async () => {
    const res = await POST(
      new Request("http://localhost/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.counts.tools.created).toBe(0);
    expect(data.counts.agents.created).toBe(0);
    expect(data.counts.workflows.created).toBe(0);
  });

  it("POST /api/import imports tools", async () => {
    const res = await POST(
      new Request("http://localhost/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tools: [
            {
              id: "imported-tool-1",
              name: "Imported Tool",
              protocol: "native",
              config: {},
              inputSchema: { type: "object", properties: {}, required: [] },
            },
          ],
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.counts.tools.created).toBe(1);
    const listRes = await toolsGet();
    const list = await listRes.json();
    expect(list.some((t: { id: string }) => t.id === "imported-tool-1")).toBe(true);
  });

  it("POST /api/import skips std- tools", async () => {
    const res = await POST(
      new Request("http://localhost/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tools: [{ id: "std-fetch-url", name: "Fetch", protocol: "native", config: {} }],
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.counts.tools.skipped).toBe(1);
  });

  it("POST /api/import imports agents", async () => {
    const res = await POST(
      new Request("http://localhost/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agents: [
            {
              id: "imported-agent-1",
              name: "Imported Agent",
              kind: "node",
              type: "internal",
              protocol: "native",
              capabilities: [],
              scopes: [],
            },
          ],
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.counts.agents.created).toBe(1);
    const listRes = await agentsGet();
    const list = await listRes.json();
    expect(list.some((a: { id: string }) => a.id === "imported-agent-1")).toBe(true);
  });

  it("POST /api/import imports workflows", async () => {
    const res = await POST(
      new Request("http://localhost/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflows: [
            {
              id: "imported-wf-1",
              name: "Imported Workflow",
              nodes: [],
              edges: [],
              executionMode: "manual",
            },
          ],
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.counts.workflows.created).toBe(1);
    const listRes = await workflowsGet();
    const list = await listRes.json();
    expect(list.some((w: { id: string }) => w.id === "imported-wf-1")).toBe(true);
  });

  it("POST /api/import with skipExisting skips existing id", async () => {
    const res = await POST(
      new Request("http://localhost/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agents: [
            {
              id: "imported-agent-1",
              name: "Duplicate",
              kind: "node",
              type: "internal",
              protocol: "native",
              capabilities: [],
              scopes: [],
            },
          ],
          options: { skipExisting: true },
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.counts.agents.skipped).toBe(1);
  });

  it("POST /api/import without skipExisting updates existing", async () => {
    const res = await POST(
      new Request("http://localhost/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agents: [
            {
              id: "imported-agent-1",
              name: "Updated Name",
              kind: "node",
              type: "internal",
              protocol: "native",
              capabilities: [],
              scopes: [],
            },
          ],
          options: { skipExisting: false },
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.counts.agents.updated).toBe(1);
  });

  it("POST /api/import skips tool when not tool-like (missing protocol)", async () => {
    const res = await POST(
      new Request("http://localhost/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tools: [{ id: "bad-tool", name: "Bad" }],
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.counts.tools.skipped).toBe(1);
    expect(data.counts.tools.created).toBe(0);
  });

  it("POST /api/import skips agent when not agent-like (missing id)", async () => {
    const res = await POST(
      new Request("http://localhost/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agents: [{ name: "No Id", kind: "node" }],
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.counts.agents.skipped).toBe(1);
    expect(data.counts.agents.created).toBe(0);
  });

  it("POST /api/import skips workflow when not workflow-like (missing name)", async () => {
    const res = await POST(
      new Request("http://localhost/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflows: [{ id: "wf-no-name" }],
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.counts.workflows.skipped).toBe(1);
    expect(data.counts.workflows.created).toBe(0);
  });

  it("POST /api/import updates existing tool when skipExisting false", async () => {
    await POST(
      new Request("http://localhost/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tools: [
            {
              id: "imported-tool-1",
              name: "Imported Tool",
              protocol: "native",
              config: {},
            },
          ],
        }),
      })
    );
    const res = await POST(
      new Request("http://localhost/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tools: [
            {
              id: "imported-tool-1",
              name: "Updated Tool Name",
              protocol: "native",
              config: {},
            },
          ],
          options: { skipExisting: false },
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.counts.tools.updated).toBe(1);
    const listRes = await toolsGet();
    const list = await listRes.json();
    const t = list.find((x: { id: string }) => x.id === "imported-tool-1");
    expect(t?.name).toBe("Updated Tool Name");
  });

  it("POST /api/import with skipExisting skips existing workflow", async () => {
    const res = await POST(
      new Request("http://localhost/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflows: [
            {
              id: "imported-wf-1",
              name: "Duplicate WF",
              nodes: [],
              edges: [],
              executionMode: "manual",
            },
          ],
          options: { skipExisting: true },
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.counts.workflows.skipped).toBe(1);
  });

  it("POST /api/import without skipExisting updates existing workflow", async () => {
    const res = await POST(
      new Request("http://localhost/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflows: [
            {
              id: "imported-wf-1",
              name: "Updated Workflow Name",
              nodes: [],
              edges: [],
              executionMode: "one_time",
            },
          ],
          options: { skipExisting: false },
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.counts.workflows.updated).toBe(1);
    const listRes = await workflowsGet();
    const list = await listRes.json();
    const w = list.find((x: { id: string }) => x.id === "imported-wf-1");
    expect(w?.name).toBe("Updated Workflow Name");
  });

  it("POST /api/import imports tool with no config (uses empty object)", async () => {
    const res = await POST(
      new Request("http://localhost/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tools: [
            {
              id: "imported-tool-no-config",
              name: "No Config Tool",
              protocol: "native",
            },
          ],
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.counts.tools.created).toBe(1);
  });

  it("POST /api/import imports workflow with default executionMode when omitted", async () => {
    const res = await POST(
      new Request("http://localhost/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflows: [
            {
              id: "imported-wf-default-mode",
              name: "Default Mode WF",
              nodes: [],
              edges: [],
            },
          ],
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.counts.workflows.created).toBe(1);
  });

  it("POST /api/import imports workflow with schedule and description", async () => {
    const res = await POST(
      new Request("http://localhost/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflows: [
            {
              id: "imported-wf-2",
              name: "Scheduled WF",
              description: "A workflow",
              nodes: [],
              edges: [],
              executionMode: "scheduled",
              schedule: "0 9 * * 1-5",
            },
          ],
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.counts.workflows.created).toBe(1);
  });

  it("POST /api/import normalizes non-array capabilities and scopes to empty array", async () => {
    const res = await POST(
      new Request("http://localhost/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agents: [
            {
              id: "agent-non-array-caps",
              name: "Agent With Non-Array",
              capabilities: null,
              scopes: "not-array",
            },
          ],
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.counts.agents.created).toBe(1);
  });
});
