import { describe, it, expect } from "vitest";
import { GET as listGet, POST as listPost } from "../../app/api/remote-servers/route";
import { GET as getOne, PATCH as patchOne, DELETE as deleteOne } from "../../app/api/remote-servers/[id]/route";

describe("Remote servers API", () => {
  let createdId: string;

  it("GET /api/remote-servers returns servers object", async () => {
    const res = await listGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("servers");
    expect(Array.isArray(data.servers)).toBe(true);
  });

  it("POST /api/remote-servers creates server", async () => {
    const res = await listPost(
      new Request("http://localhost/api/remote-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: "Test SSH",
          host: "192.168.1.1",
          port: 22,
          user: "deploy",
          authType: "key",
          keyPath: "/home/user/.ssh/id_rsa",
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.host).toBe("192.168.1.1");
    createdId = data.id;
  });

  it("GET /api/remote-servers/:id returns server", async () => {
    const res = await getOne(new Request("http://localhost/api/remote-servers/x"), {
      params: Promise.resolve({ id: createdId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(createdId);
  });

  it("PATCH /api/remote-servers/:id updates server", async () => {
    const res = await patchOne(
      new Request("http://localhost/api/remote-servers/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Updated SSH" }),
      }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.label).toBe("Updated SSH");
  });

  it("DELETE /api/remote-servers/:id removes server", async () => {
    const res = await deleteOne(
      new Request("http://localhost/api/remote-servers/x", { method: "DELETE" }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
  });
});
