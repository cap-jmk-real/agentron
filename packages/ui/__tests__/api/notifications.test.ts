import { describe, it, expect, beforeEach } from "vitest";
import { GET } from "../../app/api/notifications/route";
import { POST as clearPost } from "../../app/api/notifications/clear/route";
import {
  createNotification,
  clearAll,
  listNotifications,
} from "../../app/api/_lib/notifications-store";

describe("Notifications API", () => {
  beforeEach(() => {
    clearAll();
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
    createNotification({
      type: "run",
      sourceId: "run-1",
      title: "Run completed",
      message: "",
      severity: "success",
    });
    createNotification({
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
    createNotification({ type: "run", sourceId: "r1", title: "Run done", severity: "info" });
    createNotification({ type: "chat", sourceId: "c1", title: "New reply", severity: "info" });

    const res = await GET(new Request("http://localhost/api/notifications?types=run"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items.length).toBe(1);
    expect(data.items[0].type).toBe("run");
    expect(data.totalActiveCount).toBe(2);
  });

  it("GET /api/notifications respects limit and offset", async () => {
    createNotification({ type: "run", sourceId: "r1", title: "A", severity: "info" });
    createNotification({ type: "run", sourceId: "r2", title: "B", severity: "info" });
    createNotification({ type: "run", sourceId: "r3", title: "C", severity: "info" });

    const res = await GET(new Request("http://localhost/api/notifications?limit=2&offset=0"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items.length).toBe(2);
    expect(data.totalActiveCount).toBe(3);
  });

  it("POST /api/notifications/clear with id clears one notification", async () => {
    const n = createNotification({ type: "run", sourceId: "r1", title: "Run completed", severity: "success" });

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

    const { items, totalActiveCount } = listNotifications({ status: "active" });
    expect(items.length).toBe(0);
    expect(totalActiveCount).toBe(0);
  });

  it("POST /api/notifications/clear with ids clears multiple", async () => {
    const n1 = createNotification({ type: "run", sourceId: "r1", title: "One", severity: "info" });
    const n2 = createNotification({ type: "run", sourceId: "r2", title: "Two", severity: "info" });

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
    expect(listNotifications({ status: "active" }).items.length).toBe(0);
  });

  it("POST /api/notifications/clear with empty body clears all active", async () => {
    createNotification({ type: "run", sourceId: "r1", title: "One", severity: "info" });
    createNotification({ type: "chat", sourceId: "c1", title: "Two", severity: "info" });

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
    expect(listNotifications({ status: "active" }).items.length).toBe(0);
  });

  it("POST /api/notifications/clear with types clears only that type", async () => {
    createNotification({ type: "run", sourceId: "r1", title: "Run", severity: "info" });
    createNotification({ type: "chat", sourceId: "c1", title: "Chat", severity: "info" });

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
    const { items } = listNotifications({ status: "active" });
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
});
