import { describe, it, expect, beforeAll } from "vitest";
import { GET } from "../../app/api/chat/run-waiting/route";
import { POST as executePost } from "../../app/api/agents/[id]/execute/route";
import { GET as agentsGet, POST as agentsPost } from "../../app/api/agents/route";
import { PATCH as runPatch } from "../../app/api/runs/[id]/route";
import { db, executions } from "../../app/api/_lib/db";
import { eq } from "drizzle-orm";

describe("Chat run-waiting API", () => {
  let runId: string;
  let conversationId: string;

  beforeAll(async () => {
    let agentId: string;
    const listRes = await agentsGet();
    const list = await listRes.json();
    if (Array.isArray(list) && list.length > 0) {
      agentId = list[0].id;
    } else {
      const createRes = await agentsPost(
        new Request("http://localhost/api/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Run-waiting Agent",
            kind: "node",
            type: "internal",
            protocol: "native",
            capabilities: [],
            scopes: [],
          }),
        })
      );
      const created = await createRes.json();
      agentId = created.id;
    }
    const execRes = await executePost(
      new Request("http://localhost/api/agents/x/execute", { method: "POST" }),
      {
        params: Promise.resolve({ id: agentId }),
      }
    );
    expect(execRes.status).toBe(202);
    const execBody = await execRes.json();
    runId = execBody.id;
    conversationId = crypto.randomUUID();
    await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "waiting_for_user",
          output: { question: "Your choice?", options: ["A", "B"] },
        }),
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    await db.update(executions).set({ conversationId }).where(eq(executions.id, runId)).run();
  });

  it("GET /api/chat/run-waiting returns runWaiting false when no conversationId", async () => {
    const res = await GET(new Request("http://localhost/api/chat/run-waiting"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.runWaiting).toBe(false);
  });

  it("GET /api/chat/run-waiting returns runWaiting false for unknown conversationId", async () => {
    const res = await GET(
      new Request("http://localhost/api/chat/run-waiting?conversationId=unknown-conv-id")
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.runWaiting).toBe(false);
  });

  it("GET /api/chat/run-waiting returns runWaiting true with runId and question when run exists", async () => {
    const res = await GET(
      new Request(`http://localhost/api/chat/run-waiting?conversationId=${conversationId}`)
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.runWaiting).toBe(true);
    expect(data.runId).toBe(runId);
    expect(data.question).toBe("Your choice?");
    expect(data.options).toEqual(["A", "B"]);
  });

  it("GET /api/chat/run-waiting returns runWaiting true with question from message when output has message but no question", async () => {
    const convId2 = crypto.randomUUID();
    const list = await agentsGet().then((r) => r.json());
    const agentId = Array.isArray(list) && list.length > 0 ? list[0].id : "";
    if (!agentId) return;
    const execRes = await executePost(
      new Request("http://localhost/api/agents/x/execute", { method: "POST" }),
      { params: Promise.resolve({ id: agentId }) }
    );
    const runBody = await execRes.json();
    await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "waiting_for_user",
          output: { message: "Please confirm", options: ["Yes", "No"] },
        }),
      }),
      { params: Promise.resolve({ id: runBody.id }) }
    );
    await db
      .update(executions)
      .set({ conversationId: convId2 })
      .where(eq(executions.id, runBody.id))
      .run();
    const res = await GET(
      new Request(`http://localhost/api/chat/run-waiting?conversationId=${convId2}`)
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.runWaiting).toBe(true);
    expect(data.question).toBe("Please confirm");
    expect(data.options).toEqual(["Yes", "No"]);
  });

  it("GET /api/chat/run-waiting returns runWaiting true when output is invalid JSON", async () => {
    const convId3 = crypto.randomUUID();
    const listRes = await agentsGet();
    const list = await listRes.json();
    let agentId: string;
    if (Array.isArray(list) && list.length > 0) {
      agentId = list[0].id;
    } else {
      const createRes = await agentsPost(
        new Request("http://localhost/api/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Run-waiting Agent 2",
            kind: "node",
            type: "internal",
            protocol: "native",
            capabilities: [],
            scopes: [],
          }),
        })
      );
      agentId = (await createRes.json()).id;
    }
    const execRes = await executePost(
      new Request("http://localhost/api/agents/x/execute", { method: "POST" }),
      { params: Promise.resolve({ id: agentId }) }
    );
    const runBody = await execRes.json();
    await runPatch(
      new Request("http://localhost/api/runs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "waiting_for_user",
          output: "invalid json string",
        }),
      }),
      { params: Promise.resolve({ id: runBody.id }) }
    );
    await db
      .update(executions)
      .set({ conversationId: convId3 })
      .where(eq(executions.id, runBody.id))
      .run();
    const res = await GET(
      new Request(`http://localhost/api/chat/run-waiting?conversationId=${convId3}`)
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.runWaiting).toBe(true);
    expect(data.runId).toBe(runBody.id);
    expect(data.options).toEqual([]);
  });
});
