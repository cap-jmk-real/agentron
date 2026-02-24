import { describe, it, expect } from "vitest";
import { GET as listGet, POST as listPost } from "../../app/api/remote-servers/route";
import {
  GET as getOne,
  PATCH as patchOne,
  DELETE as deleteOne,
} from "../../app/api/remote-servers/[id]/route";

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

  it("POST /api/remote-servers creates server with defaults (label, port, authType password)", async () => {
    const res = await listPost(
      new Request("http://localhost/api/remote-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: "10.0.0.1",
          user: "root",
          authType: "password",
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.label).toBe("Remote server");
    expect(data.port).toBe(22);
    expect(data.authType).toBe("password");
  });

  it("POST /api/remote-servers creates server with custom port", async () => {
    const res = await listPost(
      new Request("http://localhost/api/remote-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: "host.local",
          user: "u",
          authType: "key",
          port: 2222,
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.port).toBe(2222);
  });

  it("POST /api/remote-servers creates server with modelBaseUrl", async () => {
    const res = await listPost(
      new Request("http://localhost/api/remote-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: "llm.local",
          user: "api",
          authType: "key",
          modelBaseUrl: "http://llm.local/v1",
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.modelBaseUrl).toBe("http://llm.local/v1");
  });

  it("GET /api/remote-servers/:id returns 404 for unknown id", async () => {
    const res = await getOne(new Request("http://localhost/api/remote-servers/x"), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Not found");
  });

  it("GET /api/remote-servers/:id returns server", async () => {
    const res = await getOne(new Request("http://localhost/api/remote-servers/x"), {
      params: Promise.resolve({ id: createdId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(createdId);
  });

  it("PATCH /api/remote-servers/:id returns 404 for unknown id", async () => {
    const res = await patchOne(
      new Request("http://localhost/api/remote-servers/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "X" }),
      }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) }
    );
    expect(res.status).toBe(404);
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

  it("PATCH /api/remote-servers/:id updates keyPath and modelBaseUrl", async () => {
    const res = await patchOne(
      new Request("http://localhost/api/remote-servers/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyPath: "/new/path",
          modelBaseUrl: "http://new.url",
        }),
      }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.keyPath).toBe("/new/path");
    expect(data.modelBaseUrl).toBe("http://new.url");
  });

  it("DELETE /api/remote-servers/:id removes server", async () => {
    const res = await deleteOne(
      new Request("http://localhost/api/remote-servers/x", { method: "DELETE" }),
      { params: Promise.resolve({ id: createdId }) }
    );
    expect(res.status).toBe(200);
  });
});
