import { describe, it, expect, beforeAll } from "vitest";
import { db, vaultMeta } from "../../app/api/_lib/db";
import { eq } from "drizzle-orm";
import { POST as createPost } from "../../app/api/vault/create/route";
import { POST as unlockPost } from "../../app/api/vault/unlock/route";
import { GET as credentialsGet } from "../../app/api/vault/credentials/route";
import { PATCH as credentialPatch } from "../../app/api/vault/credentials/[key]/route";
import { DELETE as credentialDelete } from "../../app/api/vault/credentials/[key]/route";
import { POST as clearPost } from "../../app/api/vault/credentials/clear/route";
import { POST as importPost } from "../../app/api/vault/credentials/import/route";

describe("Vault credentials API", () => {
  let cookieHeader: string;

  beforeAll(async () => {
    await db.delete(vaultMeta).where(eq(vaultMeta.id, "default")).run();
    const createRes = await createPost(
      new Request("http://localhost/api/vault/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ masterPassword: "test-creds-password" }),
      })
    );
    expect(createRes.status).toBe(200);
    const unlockRes = await unlockPost(
      new Request("http://localhost/api/vault/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ masterPassword: "test-creds-password" }),
      })
    );
    expect(unlockRes.status).toBe(200);
    cookieHeader = unlockRes.headers.get("Set-Cookie") ?? "";
    expect(cookieHeader).toMatch(/agentron_vault=/);
  });

  const withCookie = (req: Request) => {
    return new Request(req.url, { method: req.method, headers: { ...Object.fromEntries(req.headers), Cookie: cookieHeader }, body: req.body });
  };

  it("GET /api/vault/credentials returns 403 when vault locked", async () => {
    const res = await credentialsGet(new Request("http://localhost/api/vault/credentials"));
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("locked");
  });

  it("GET /api/vault/credentials returns keys array when unlocked", async () => {
    const res = await credentialsGet(withCookie(new Request("http://localhost/api/vault/credentials")));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("keys");
    expect(Array.isArray(data.keys)).toBe(true);
  });

  it("PATCH /api/vault/credentials/[key] returns 403 when vault locked", async () => {
    const res = await credentialPatch(
      new Request("http://localhost/api/vault/credentials/test-key", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "secret" }),
      }),
      { params: Promise.resolve({ key: "test-key" }) }
    );
    expect(res.status).toBe(403);
  });

  it("PATCH /api/vault/credentials/[key] updates credential when unlocked", async () => {
    const res = await credentialPatch(
      new Request("http://localhost/api/vault/credentials/my-key", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookieHeader },
        body: JSON.stringify({ value: "my-secret-value" }),
      }),
      { params: Promise.resolve({ key: "my-key" }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it("PATCH /api/vault/credentials/[key] returns 400 when value missing", async () => {
    const res = await credentialPatch(
      new Request("http://localhost/api/vault/credentials/other", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookieHeader },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ key: "other" }) }
    );
    expect(res.status).toBe(400);
  });

  it("DELETE /api/vault/credentials/[key] returns 403 when vault locked", async () => {
    const res = await credentialDelete(new Request("http://localhost/api/vault/credentials/some-key", { method: "DELETE" }), {
      params: Promise.resolve({ key: "some-key" }),
    });
    expect(res.status).toBe(403);
  });

  it("DELETE /api/vault/credentials/[key] returns ok when unlocked", async () => {
    const res = await credentialDelete(
      withCookie(new Request("http://localhost/api/vault/credentials/my-key", { method: "DELETE" })),
      { params: Promise.resolve({ key: "my-key" }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it("POST /api/vault/credentials/clear returns 403 when vault locked", async () => {
    const res = await clearPost(new Request("http://localhost/api/vault/credentials/clear", { method: "POST" }));
    expect(res.status).toBe(403);
  });

  it("POST /api/vault/credentials/clear returns ok and deleted count when unlocked", async () => {
    const res = await clearPost(withCookie(new Request("http://localhost/api/vault/credentials/clear", { method: "POST" })));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(typeof data.deleted).toBe("number");
  });

  it("POST /api/vault/credentials/import returns 403 when vault locked", async () => {
    const res = await importPost(
      new Request("http://localhost/api/vault/credentials/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: [{ key: "k", value: "v" }] }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/vault/credentials/import returns 400 when content-type not JSON or form", async () => {
    const res = await importPost(
      new Request("http://localhost/api/vault/credentials/import", {
        method: "POST",
        headers: { "Content-Type": "text/plain", Cookie: cookieHeader },
        body: "x",
      })
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/vault/credentials/import imports entries when unlocked", async () => {
    const res = await importPost(
      new Request("http://localhost/api/vault/credentials/import", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieHeader },
        body: JSON.stringify({ entries: [{ key: "imported-key", value: "imported-value" }] }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.imported).toBe(1);
    expect(data.total).toBe(1);
  });
});
