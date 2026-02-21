import { describe, it, expect, beforeEach } from "vitest";
import { GET } from "../../app/api/notifications/route";
import { POST as clearPost } from "../../app/api/notifications/clear/route";
import {
  createNotification,
  createChatNotification,
  clearActiveBySourceId,
  clearAll,
  listNotifications,
} from "../../app/api/_lib/notifications-store";

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

  it("GET /api/notifications filters by types=run", async () => {
    await createNotification({ type: "run", sourceId: "r1", title: "Run done", severity: "info" });
    await createNotification({ type: "chat", sourceId: "c1", title: "New reply", severity: "info" });

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

  it("POST /api/notifications/clear with id clears one notification", async () => {
    const n = await createNotification({ type: "run", sourceId: "r1", title: "Run completed", severity: "success" });

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
    const n1 = await createNotification({ type: "run", sourceId: "r1", title: "One", severity: "info" });
    const n2 = await createNotification({ type: "run", sourceId: "r2", title: "Two", severity: "info" });

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
      await createNotification({ type: "run", sourceId: "run-abc", title: "Run completed", severity: "success" });
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
