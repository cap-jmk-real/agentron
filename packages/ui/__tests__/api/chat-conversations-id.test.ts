import { describe, it, expect } from "vitest";
import { POST as listPost } from "../../app/api/chat/conversations/route";
import { GET, PATCH, DELETE } from "../../app/api/chat/conversations/[id]/route";

describe("Chat conversations [id] API", () => {
  let conversationId: string;

  it("GET /api/chat/conversations/:id returns 404 for unknown id", async () => {
    const res = await GET(new Request("http://localhost/api/chat/conversations/x"), {
      params: Promise.resolve({ id: "non-existent-conv-id" }),
    });
    expect(res.status).toBe(404);
  });

  it("GET /api/chat/conversations/:id returns conversation", async () => {
    const createRes = await listPost(
      new Request("http://localhost/api/chat/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Conv for id test" }),
      })
    );
    const created = await createRes.json();
    conversationId = created.id;

    const res = await GET(new Request("http://localhost/api/chat/conversations/x"), {
      params: Promise.resolve({ id: conversationId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(conversationId);
    expect(data.title).toBe("Conv for id test");
  });

  it("PATCH /api/chat/conversations/:id updates conversation", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/chat/conversations/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Updated title", rating: 5 }),
      }),
      { params: Promise.resolve({ id: conversationId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.title).toBe("Updated title");
    expect(data.rating).toBe(5);
  });

  it("DELETE /api/chat/conversations/:id removes conversation", async () => {
    const res = await DELETE(
      new Request("http://localhost/api/chat/conversations/x", { method: "DELETE" }),
      {
        params: Promise.resolve({ id: conversationId }),
      }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    const getRes = await GET(new Request("http://localhost/api/chat/conversations/x"), {
      params: Promise.resolve({ id: conversationId }),
    });
    expect(getRes.status).toBe(404);
  });
});
