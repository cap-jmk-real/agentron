import { describe, it, expect, beforeAll } from "vitest";
import { db, vaultMeta } from "../../app/api/_lib/db";
import { eq } from "drizzle-orm";
import { POST as createPost } from "../../app/api/vault/create/route";
import { GET as statusGet } from "../../app/api/vault/status/route";
import { POST as lockPost } from "../../app/api/vault/lock/route";
import { POST as unlockPost } from "../../app/api/vault/unlock/route";

describe("Vault create API", () => {
  beforeAll(async () => {
    // Remove default vault if present so create can succeed in tests that need it
    await db.delete(vaultMeta).where(eq(vaultMeta.id, "default")).run();
  });

  it("POST /api/vault/create returns 400 when masterPassword missing", async () => {
    const res = await createPost(
      new Request("http://localhost/api/vault/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("masterPassword");
  });

  it("POST /api/vault/create returns 400 when masterPassword empty", async () => {
    const res = await createPost(
      new Request("http://localhost/api/vault/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ masterPassword: "   " }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/vault/create creates vault and returns 201 with Set-Cookie", async () => {
    const res = await createPost(
      new Request("http://localhost/api/vault/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ masterPassword: "test-vault-password-123" }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(res.headers.get("Set-Cookie")).toMatch(/agentron_vault=/);
  });

  it("POST /api/vault/create returns 400 when vault already exists", async () => {
    const res = await createPost(
      new Request("http://localhost/api/vault/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ masterPassword: "another-password" }),
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("already exists");
  });

  it("GET /api/vault/status returns vaultExists true when vault exists", async () => {
    const res = await statusGet(new Request("http://localhost/api/vault/status"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.vaultExists).toBe(true);
  });

  it("POST /api/vault/lock returns ok and Set-Cookie clear", async () => {
    const res = await lockPost();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(res.headers.get("Set-Cookie")).toBeDefined();
  });

  it("POST /api/vault/unlock returns 400 when masterPassword missing", async () => {
    const res = await unlockPost(
      new Request("http://localhost/api/vault/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("masterPassword");
  });

  it("POST /api/vault/unlock returns 401 when password wrong", async () => {
    const res = await unlockPost(
      new Request("http://localhost/api/vault/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ masterPassword: "wrong-password" }),
      })
    );
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toContain("Invalid");
  });

  it("POST /api/vault/unlock returns ok with Set-Cookie when password correct", async () => {
    const res = await unlockPost(
      new Request("http://localhost/api/vault/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ masterPassword: "test-vault-password-123" }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(res.headers.get("Set-Cookie")).toMatch(/agentron_vault=/);
  });
});
