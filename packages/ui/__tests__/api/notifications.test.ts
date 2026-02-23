import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET } from "../../app/api/notifications/route";
import { POST as clearPost } from "../../app/api/notifications/clear/route";
import {
  createNotification,
  createChatNotification,
  createRunNotification,
  clearActiveBySourceId,
  clearAll,
  clearBulk,
  clearOne,
  listNotifications,
} from "../../app/api/_lib/notifications-store";
import {
  db,
  executions,
  workflows,
  agents,
  conversations,
  toExecutionRow,
  notificationsTable,
} from "../../app/api/_lib/db";
import { POST as workflowsPost } from "../../app/api/workflows/route";
import { POST as agentsPost } from "../../app/api/agents/route";

describe("Notifications API", () => {
  beforeEach(async () => {
    await clearAll();
  });

  it("GET /api/notifications returns empty list and zero count when no notifications", async () => {
    const res = await GET(new Request("http://localhost/api/notifications"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.items)).toBe(true);
    expect(data.items.length).toBe(0);
    expect(data.totalActiveCount).toBe(0);
  });

  it("GET /api/notifications returns active notifications and totalActiveCount", async () => {
    await createNotification({
      type: "run",
      sourceId: "run-1",
      title: "Run completed",
      message: "",
      severity: "success",
    });
    await createNotification({
      type: "run",
      sourceId: "run-2",
      title: "Run failed",
      message: "Error",
      severity: "error",
    });

    const res = await GET(new Request("http://localhost/api/notifications"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items.length).toBe(2);
    expect(data.totalActiveCount).toBe(2);
    expect(data.items[0].title).toBe("Run failed"); // newest first
    expect(data.items[0].type).toBe("run");
    expect(data.items[0].severity).toBe("error");
    expect(data.items[1].title).toBe("Run completed");
  });

  it("GET /api/notifications with empty types param returns all types", async () => {
    const res = await GET(new Request("http://localhost/api/notifications?types="));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.items)).toBe(true);
  });

  it("GET /api/notifications with limit=0 returns up to 0 items", async () => {
    const res = await GET(new Request("http://localhost/api/notifications?limit=0"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.items)).toBe(true);
    expect(data.items.length).toBeLessThanOrEqual(0);
  });

  it("GET /api/notifications filters by types=run", async () => {
    await createNotification({ type: "run", sourceId: "r1", title: "Run done", severity: "info" });
    await createNotification({
      type: "chat",
      sourceId: "c1",
      title: "New reply",
      severity: "info",
    });

    const res = await GET(new Request("http://localhost/api/notifications?types=run"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items.length).toBe(1);
    expect(data.items[0].type).toBe("run");
    expect(data.totalActiveCount).toBe(2);
  });

  it("GET /api/notifications filters by types=chat", async () => {
    await createChatNotification("conv-1");
    await createNotification({ type: "run", sourceId: "r1", title: "Run done", severity: "info" });

    const res = await GET(new Request("http://localhost/api/notifications?types=chat"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items.length).toBe(1);
    expect(data.items[0].type).toBe("chat");
    expect(data.items[0].sourceId).toBe("conv-1");
    expect(data.items[0].title).toBe("Chat needs your input");
    expect(data.totalActiveCount).toBe(2);
  });

  it("GET /api/notifications filters by types=run,chat", async () => {
    await createChatNotification("conv-1");
    await createNotification({ type: "run", sourceId: "r1", title: "Run done", severity: "info" });

    const res = await GET(new Request("http://localhost/api/notifications?types=run,chat"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items.length).toBe(2);
    expect(data.totalActiveCount).toBe(2);
    const types = data.items.map((i: { type: string }) => i.type).sort();
    expect(types).toEqual(["chat", "run"]);
  });

  it("GET /api/notifications respects limit and offset", async () => {
    await createNotification({ type: "run", sourceId: "r1", title: "A", severity: "info" });
    await createNotification({ type: "run", sourceId: "r2", title: "B", severity: "info" });
    await createNotification({ type: "run", sourceId: "r3", title: "C", severity: "info" });

    const res = await GET(new Request("http://localhost/api/notifications?limit=2&offset=0"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items.length).toBe(2);
    expect(data.totalActiveCount).toBe(3);
  });

  it("listNotifications with status cleared returns cleared items", async () => {
    const n = await createNotification({
      type: "run",
      sourceId: "r1",
      title: "Done",
      severity: "info",
    });
    await clearAll();
    const { items, totalActiveCount } = await listNotifications({ status: "cleared" });
    expect(items.length).toBeGreaterThanOrEqual(1);
    const found = items.find((i: { id: string }) => i.id === n.id);
    expect(found).toBeDefined();
    expect(found!.status).toBe("cleared");
    expect(totalActiveCount).toBe(0);
  });

  it("GET /api/notifications?status=cleared returns cleared notifications", async () => {
    const n = await createNotification({
      type: "run",
      sourceId: "r1",
      title: "Old",
      severity: "info",
    });
    await clearAll();
    const res = await GET(new Request("http://localhost/api/notifications?status=cleared"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items.length).toBeGreaterThanOrEqual(1);
    const found = data.items.find((i: { id: string }) => i.id === n.id);
    expect(found).toBeDefined();
    expect(found.status).toBe("cleared");
  });

  it("GET /api/notifications accepts limit and offset query params", async () => {
    const res = await GET(new Request("http://localhost/api/notifications?limit=10&offset=0"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items.length).toBeLessThanOrEqual(10);
  });

  it("GET /api/notifications clamps limit to 200", async () => {
    const res = await GET(new Request("http://localhost/api/notifications?limit=500"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items.length).toBeLessThanOrEqual(200);
  });

  it("GET /api/notifications respects offset param", async () => {
    await createNotification({ type: "run", sourceId: "r1", title: "A", severity: "info" });
    await createNotification({ type: "run", sourceId: "r2", title: "B", severity: "info" });
    await createNotification({ type: "run", sourceId: "r3", title: "C", severity: "info" });
    const res = await GET(new Request("http://localhost/api/notifications?limit=2&offset=1"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items.length).toBeLessThanOrEqual(2);
    expect(data.totalActiveCount).toBe(3);
  });

  it("clearBulk with empty array returns 0", async () => {
    const cleared = await clearBulk([]);
    expect(cleared).toBe(0);
  });

  it("clearOne with non-existent id returns false", async () => {
    const ok = await clearOne("00000000-0000-0000-0000-000000000000");
    expect(ok).toBe(false);
  });

  it("clearOne when already cleared returns true (idempotent)", async () => {
    const n = await createNotification({
      type: "run",
      sourceId: "r1",
      title: "Done",
      severity: "info",
    });
    await clearOne(n.id);
    const ok = await clearOne(n.id);
    expect(ok).toBe(true);
  });

  it("createRunNotification creates notification for completed, failed, waiting_for_user", async () => {
    const completed = await createRunNotification("run-1", "completed");
    expect(completed.title).toBe("Run completed");
    expect(completed.severity).toBe("success");
    const failed = await createRunNotification("run-2", "failed");
    expect(failed.title).toBe("Run failed");
    expect(failed.severity).toBe("error");
    const waiting = await createRunNotification("run-3", "waiting_for_user");
    expect(waiting.title).toBe("Run needs your input");
    expect(waiting.severity).toBe("warning");
  });

  it("createNotification with no message and no metadata stores empty message and null metadata", async () => {
    const n = await createNotification({
      type: "run",
      sourceId: "r-meta",
      title: "Title",
      message: undefined,
      metadata: undefined,
    });
    expect(n.message).toBe("");
    expect(n.metadata).toBeUndefined();
  });

  it("createRunNotification uses Run updated title when status is unknown (defensive fallback)", async () => {
    const n = await createRunNotification(
      "run-unknown",
      "unknown" as "completed" | "failed" | "waiting_for_user"
    );
    expect(n.title).toBe("Run updated");
  });

  it("listNotifications returns notification with undefined metadata when row has invalid JSON metadata", async () => {
    const id = crypto.randomUUID();
    const now = Date.now();
    await db
      .insert(notificationsTable)
      .values({
        id,
        type: "run",
        sourceId: "r1",
        title: "Bad meta",
        message: "",
        severity: "info",
        status: "active",
        createdAt: now,
        updatedAt: now,
        metadata: "{ invalid json",
      })
      .run();
    const { items } = await listNotifications({});
    const found = items.find((i: { id: string }) => i.id === id);
    expect(found).toBeDefined();
    expect(found!.metadata).toBeUndefined();
  });

  it("clearAll returns 0 when no active notifications match", async () => {
    const cleared = await clearAll();
    expect(cleared).toBe(0);
  });

  it("clearActiveBySourceId returns 0 when no notification matches type and sourceId", async () => {
    const cleared = await clearActiveBySourceId("chat", "no-such-conv-" + Date.now());
    expect(cleared).toBe(0);
  });

  it("clearAll with types filter clears only matching types", async () => {
    await createNotification({ type: "run", sourceId: "r1", title: "Run", severity: "info" });
    await createChatNotification("conv-1");
    const cleared = await clearAll(["run"]);
    expect(cleared).toBe(1);
    const { items } = await listNotifications({ status: "active" });
    expect(items.length).toBe(1);
    expect(items[0].type).toBe("chat");
  });

  it("GET /api/notifications enriches run notifications with targetName from workflow/agent", async () => {
    const wfRes = await workflowsPost(
      new Request("http://localhost/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Notif Workflow",
          nodes: [],
          edges: [],
          executionMode: "manual",
        }),
      })
    );
    const wf = await wfRes.json();
    const runId = crypto.randomUUID();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: runId,
          targetType: "workflow",
          targetId: wf.id,
          status: "completed",
        })
      )
      .run();
    await createNotification({
      type: "run",
      sourceId: runId,
      title: "Run completed",
      severity: "success",
    });
    const res = await GET(new Request("http://localhost/api/notifications"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items.length).toBe(1);
    expect(data.items[0].type).toBe("run");
    expect(data.items[0].targetName).toBe("Notif Workflow");
  });

  it("GET /api/notifications enriches run notifications with targetName from agent when execution has targetType agent", async () => {
    const agentRes = await agentsPost(
      new Request("http://localhost/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Notif Agent",
          kind: "node",
          type: "internal",
          protocol: "native",
          capabilities: [],
          scopes: [],
        }),
      })
    );
    const agent = await agentRes.json();
    const runId = crypto.randomUUID();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: runId,
          targetType: "agent",
          targetId: agent.id,
          status: "completed",
        })
      )
      .run();
    await createNotification({
      type: "run",
      sourceId: runId,
      title: "Agent run completed",
      severity: "success",
    });
    const res = await GET(new Request("http://localhost/api/notifications"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items.length).toBe(1);
    expect(data.items[0].type).toBe("run");
    expect(data.items[0].targetName).toBe("Notif Agent");
  });

  it("GET /api/notifications uses targetName fallback (metadata.targetId then sourceId) when run has no workflow/agent", async () => {
    const orphanRunId = "orphan-run-" + Date.now();
    await createNotification({
      type: "run",
      sourceId: orphanRunId,
      title: "Run completed",
      severity: "success",
      metadata: { targetId: "custom-target" },
    });
    const res = await GET(new Request("http://localhost/api/notifications"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items.length).toBe(1);
    expect(data.items[0].targetName).toBe("custom-target");
  });

  it("GET /api/notifications uses sourceId as targetName when run has no workflow/agent and no metadata.targetId", async () => {
    const orphanRunId = "orphan-run-2-" + Date.now();
    await createNotification({
      type: "run",
      sourceId: orphanRunId,
      title: "Run completed",
      severity: "success",
    });
    const res = await GET(new Request("http://localhost/api/notifications"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items.length).toBe(1);
    expect(data.items[0].targetName).toBe(orphanRunId);
  });

  it("GET /api/notifications returns system notifications in items without run/chat enrichment", async () => {
    await createNotification({
      type: "system",
      sourceId: "sys-1",
      title: "System notice",
      message: "Update available",
      severity: "info",
    });
    const res = await GET(new Request("http://localhost/api/notifications"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items.length).toBe(1);
    expect(data.items[0].type).toBe("system");
    expect(data.items[0].title).toBe("System notice");
    expect(data.items[0].sourceId).toBe("sys-1");
  });

  it("GET /api/notifications uses sourceId as conversationTitle when chat conversation has no row", async () => {
    const convId = "orphan-chat-" + Date.now();
    await createChatNotification(convId);
    const res = await GET(new Request("http://localhost/api/notifications"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items.length).toBe(1);
    expect(data.items[0].type).toBe("chat");
    expect(data.items[0].conversationTitle).toBe(convId);
  });

  it("GET /api/notifications enriches chat notifications with conversationTitle when conversation exists", async () => {
    const convId = crypto.randomUUID();
    await db
      .insert(conversations)
      .values({
        id: convId,
        title: "Test conversation",
        createdAt: Date.now(),
      })
      .run();
    await createChatNotification(convId);
    const res = await GET(new Request("http://localhost/api/notifications?types=chat"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items.length).toBe(1);
    expect(data.items[0].conversationTitle).toBe("Test conversation");
  });

  it("GET /api/notifications enriches chat with empty conversationTitle when conversation has null title", async () => {
    const convId = crypto.randomUUID();
    await db.insert(conversations).values({ id: convId, title: null, createdAt: Date.now() }).run();
    await createChatNotification(convId);
    const res = await GET(new Request("http://localhost/api/notifications?types=chat"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items.length).toBe(1);
    expect(data.items[0].conversationTitle).toBe("");
  });

  it("GET /api/notifications uses targetName fallback when workflow name is null", async () => {
    const wfRes = await workflowsPost(
      new Request("http://localhost/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "NullNameWF",
          nodes: [],
          edges: [],
          executionMode: "manual",
        }),
      })
    );
    const wf = await wfRes.json();
    const runId = crypto.randomUUID();
    await db
      .insert(executions)
      .values(
        toExecutionRow({
          id: runId,
          targetType: "workflow",
          targetId: wf.id,
          status: "completed",
        })
      )
      .run();
    await createNotification({
      type: "run",
      sourceId: runId,
      title: "Run done",
      severity: "info",
    });
    let selectCallCount = 0;
    const origSelect = db.select.bind(db);
    const spy = vi.spyOn(db, "select").mockImplementation(((...args: unknown[]) => {
      selectCallCount++;
      if (selectCallCount === 3) {
        return {
          from: () => ({
            where: () =>
              Promise.resolve([{ id: wf.id, name: null } as { id: string; name: string | null }]),
          }),
        } as unknown as ReturnType<typeof db.select>;
      }
      return origSelect(...(args as Parameters<typeof db.select>));
    }) as typeof db.select);
    try {
      const res = await GET(new Request("http://localhost/api/notifications"));
      expect(res.status).toBe(200);
      const data = await res.json();
      const runItem = data.items.find((i: { sourceId: string }) => i.sourceId === runId);
      expect(runItem).toBeDefined();
      expect(runItem.targetName).toBe(runId);
    } finally {
      spy.mockRestore();
    }
  });

  it("POST /api/notifications/clear with body non-object returns 400", async () => {
    const res = await clearPost(
      new Request("http://localhost/api/notifications/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "5",
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Body must be an object");
  });

  it("POST /api/notifications/clear with id non-string treats as empty and returns cleared 0", async () => {
    const res = await clearPost(
      new Request("http://localhost/api/notifications/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 123 }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cleared).toBe(0);
  });

  it("POST /api/notifications/clear with id clears one notification", async () => {
    const n = await createNotification({
      type: "run",
      sourceId: "r1",
      title: "Run completed",
      severity: "success",
    });

    const res = await clearPost(
      new Request("http://localhost/api/notifications/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: n.id }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cleared).toBe(1);

    const { items, totalActiveCount } = await listNotifications({ status: "active" });
    expect(items.length).toBe(0);
    expect(totalActiveCount).toBe(0);
  });

  it("POST /api/notifications/clear with ids clears multiple", async () => {
    const n1 = await createNotification({
      type: "run",
      sourceId: "r1",
      title: "One",
      severity: "info",
    });
    const n2 = await createNotification({
      type: "run",
      sourceId: "r2",
      title: "Two",
      severity: "info",
    });

    const res = await clearPost(
      new Request("http://localhost/api/notifications/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [n1.id, n2.id] }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cleared).toBe(2);
    expect((await listNotifications({ status: "active" })).items.length).toBe(0);
  });

  it("POST /api/notifications/clear with ids array filters non-strings", async () => {
    const n = await createNotification({
      type: "run",
      sourceId: "r1",
      title: "One",
      severity: "info",
    });
    const res = await clearPost(
      new Request("http://localhost/api/notifications/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [n.id, 123, null] }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cleared).toBe(1);
  });

  it("POST /api/notifications/clear with empty body clears all active", async () => {
    await createNotification({ type: "run", sourceId: "r1", title: "One", severity: "info" });
    await createNotification({ type: "chat", sourceId: "c1", title: "Two", severity: "info" });

    const res = await clearPost(
      new Request("http://localhost/api/notifications/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cleared).toBe(2);
    expect((await listNotifications({ status: "active" })).items.length).toBe(0);
  });

  it("POST /api/notifications/clear with types clears only that type", async () => {
    await createNotification({ type: "run", sourceId: "r1", title: "Run", severity: "info" });
    await createNotification({ type: "chat", sourceId: "c1", title: "Chat", severity: "info" });

    const res = await clearPost(
      new Request("http://localhost/api/notifications/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ types: ["run"] }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cleared).toBe(1);
    const { items } = await listNotifications({ status: "active" });
    expect(items.length).toBe(1);
    expect(items[0].type).toBe("chat");
  });

  it("POST /api/notifications/clear returns 400 for invalid JSON", async () => {
    const res = await clearPost(
      new Request("http://localhost/api/notifications/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      })
    );
    expect(res.status).toBe(400);
  });

  describe("chat notifications (conversation needs user input)", () => {
    it("createChatNotification creates active chat notification with correct title and severity", async () => {
      const n = await createChatNotification("conv-123");
      expect(n.type).toBe("chat");
      expect(n.sourceId).toBe("conv-123");
      expect(n.title).toBe("Chat needs your input");
      expect(n.message).toContain("Open the conversation");
      expect(n.severity).toBe("info");
      expect(n.status).toBe("active");
      expect(n.metadata?.conversationId).toBe("conv-123");

      const { items, totalActiveCount } = await listNotifications({ status: "active" });
      expect(items.length).toBe(1);
      expect(totalActiveCount).toBe(1);
      expect(items[0].id).toBe(n.id);
    });

    it("createChatNotification replaces previous active chat notification for same conversation", async () => {
      await createChatNotification("conv-same");
      const second = await createChatNotification("conv-same");
      const { items, totalActiveCount } = await listNotifications({ status: "active" });
      expect(items.length).toBe(1);
      expect(totalActiveCount).toBe(1);
      expect(items[0].id).toBe(second.id);
    });

    it("clearActiveBySourceId clears only active notifications for given type and sourceId", async () => {
      await createChatNotification("conv-a");
      await createChatNotification("conv-b");
      const cleared = await clearActiveBySourceId("chat", "conv-a");
      expect(cleared).toBe(1);
      const { items } = await listNotifications({ status: "active" });
      expect(items.length).toBe(1);
      expect(items[0].sourceId).toBe("conv-b");
    });

    it("GET /api/notifications returns chat notifications with conversationTitle", async () => {
      await createChatNotification("conv-needs-input");
      const res = await GET(new Request("http://localhost/api/notifications?types=chat"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.items.length).toBe(1);
      expect(data.items[0].type).toBe("chat");
      expect(data.items[0].title).toBe("Chat needs your input");
      expect(data.items[0]).toHaveProperty("conversationTitle");
    });

    it("GET /api/notifications returns run and chat items with correct type and sourceId for client links", async () => {
      await createNotification({
        type: "run",
        sourceId: "run-abc",
        title: "Run completed",
        severity: "success",
      });
      await createChatNotification("conv-xyz");
      const res = await GET(new Request("http://localhost/api/notifications"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.items.length).toBe(2);
      const runItem = data.items.find((n: { type: string }) => n.type === "run");
      const chatItem = data.items.find((n: { type: string }) => n.type === "chat");
      expect(runItem).toBeDefined();
      expect(runItem.sourceId).toBe("run-abc");
      expect(chatItem).toBeDefined();
      expect(chatItem.sourceId).toBe("conv-xyz");
      expect(chatItem.title).toBe("Chat needs your input");
    });
  });
});
