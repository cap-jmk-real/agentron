import { describe, it, expect, vi } from "vitest";
import { GET as listGet, POST as listPost } from "../../app/api/reminders/route";
import { GET, DELETE } from "../../app/api/reminders/[id]/route";

vi.mock("../../app/api/_lib/reminder-scheduler", () => ({
  scheduleReminder: vi.fn(),
  cancelReminderTimeout: vi.fn(),
}));

describe("Reminders [id] API", () => {
  let reminderId: string;

  it("POST a reminder then GET by id", async () => {
    const postRes = await listPost(
      new Request("http://localhost/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Get me", inMinutes: 30 }),
      })
    );
    expect(postRes.status).toBe(201);
    const postData = await postRes.json();
    reminderId = postData.id;

    const getRes = await GET(new Request("http://localhost/api/reminders/1"), {
      params: Promise.resolve({ id: reminderId }),
    });
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.id).toBe(reminderId);
    expect(getData.message).toBe("Get me");
  });

  it("GET /api/reminders/:id returns 404 for unknown id", async () => {
    const res = await GET(new Request("http://localhost/api/reminders/1"), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Not found");
  });

  it("DELETE /api/reminders/:id cancels pending reminder", async () => {
    const postRes = await listPost(
      new Request("http://localhost/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "To cancel", inMinutes: 120 }),
      })
    );
    const postData = await postRes.json();
    const id = postData.id;

    const res = await DELETE(new Request("http://localhost/api/reminders/1"), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it("DELETE /api/reminders/:id returns 404 for unknown id", async () => {
    const res = await DELETE(new Request("http://localhost/api/reminders/1"), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }),
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Not found");
  });

  it("DELETE /api/reminders/:id returns 400 when reminder not pending", async () => {
    const postRes = await listPost(
      new Request("http://localhost/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Will fire", inMinutes: 5 }),
      })
    );
    const postData = await postRes.json();
    const id = postData.id;
    await DELETE(new Request("http://localhost/api/reminders/1"), {
      params: Promise.resolve({ id }),
    });
    const res = await DELETE(new Request("http://localhost/api/reminders/1"), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("not pending");
  });
});
