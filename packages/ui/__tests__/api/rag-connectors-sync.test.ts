import { describe, it, expect } from "vitest";
import { POST } from "../../app/api/rag/connectors/[id]/sync/route";

describe("RAG connectors [id] sync API", () => {
  it("POST /api/rag/connectors/:id/sync returns 404 for non-existent connector", async () => {
    const res = await POST(new Request("http://localhost/api/rag/connectors/non-existent-id/sync", { method: "POST" }), {
      params: Promise.resolve({ id: "non-existent-id" }),
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Connector not found");
  });
});
