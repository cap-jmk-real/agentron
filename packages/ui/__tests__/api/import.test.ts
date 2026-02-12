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
          tools: [
            { id: "std-fetch-url", name: "Fetch", protocol: "native", config: {} },
          ],
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
});
