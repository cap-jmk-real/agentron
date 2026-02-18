import { describe, it, expect, vi } from "vitest";
import { GET, POST } from "../../app/api/reminders/route";

vi.mock("../../app/api/_lib/reminder-scheduler", () => ({
  scheduleReminder: vi.fn(),
}));

describe("Reminders API", () => {
  it("GET /api/reminders returns empty list when no reminders", async () => {
    const res = await GET(new Request("http://localhost/api/reminders"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("GET /api/reminders?status=pending accepts status param", async () => {
    const res = await GET(new Request("http://localhost/api/reminders?status=pending"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("GET /api/reminders?status=fired returns list", async () => {
    const res = await GET(new Request("http://localhost/api/reminders?status=fired"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("POST /api/reminders creates reminder with inMinutes", async () => {
    const res = await POST(
      new Request("http://localhost/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Test reminder", inMinutes: 60 }),
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.message).toBe("Test reminder");
    expect(data.status).toBe("pending");
    expect(typeof data.runAt).toBe("number");
  });

  it("POST /api/reminders creates reminder with at (ISO date)", async () => {
    const at = new Date(Date.now() + 3600_000).toISOString();
    const res = await POST(
      new Request("http://localhost/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "At reminder", at }),
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.message).toBe("At reminder");
  });

  it("POST /api/reminders returns 400 when message missing", async () => {
    const res = await POST(
      new Request("http://localhost/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inMinutes: 10 }),
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("message");
  });

  it("POST /api/reminders returns 400 when at invalid", async () => {
    const res = await POST(
      new Request("http://localhost/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "x", at: "not-a-date" }),
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("at");
  });

  it("POST /api/reminders returns 400 when neither at nor inMinutes", async () => {
    const res = await POST(
      new Request("http://localhost/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "x" }),
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("POST /api/reminders returns 400 when runAt in past", async () => {
    const past = new Date(Date.now() - 3600_000).toISOString();
    const res = await POST(
      new Request("http://localhost/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "x", at: past }),
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("future");
  });

  it("POST /api/reminders returns 400 for assistant_task without conversationId", async () => {
    const res = await POST(
      new Request("http://localhost/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "x", inMinutes: 60, taskType: "assistant_task" }),
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("conversationId");
  });

  it("POST /api/reminders creates assistant_task with conversationId", async () => {
    const convId = crypto.randomUUID();
    const res = await POST(
      new Request("http://localhost/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Assistant task",
          inMinutes: 60,
          taskType: "assistant_task",
          conversationId: convId,
        }),
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.taskType).toBe("assistant_task");
    expect(data.conversationId).toBe(convId);
  });
});
