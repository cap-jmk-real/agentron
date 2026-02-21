import { describe, it, expect, beforeAll, vi } from "vitest";
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
    return new Request(req.url, {
      method: req.method,
      headers: { ...Object.fromEntries(req.headers), Cookie: cookieHeader },
      body: req.body,
    });
  };

  it("GET /api/vault/credentials returns 403 when vault locked", async () => {
    const res = await credentialsGet(new Request("http://localhost/api/vault/credentials"));
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("locked");
  });

  it("GET /api/vault/credentials returns keys array when unlocked", async () => {
    const res = await credentialsGet(
      withCookie(new Request("http://localhost/api/vault/credentials"))
    );
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

  it("PATCH /api/vault/credentials/[key] updates existing credential (update path)", async () => {
    const key = "existing-key-to-update";
    await credentialPatch(
      new Request("http://localhost/api/vault/credentials/" + encodeURIComponent(key), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookieHeader },
        body: JSON.stringify({ value: "initial" }),
      }),
      { params: Promise.resolve({ key }) }
    );
    const res = await credentialPatch(
      new Request("http://localhost/api/vault/credentials/" + encodeURIComponent(key), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookieHeader },
        body: JSON.stringify({ value: "updated-value" }),
      }),
      { params: Promise.resolve({ key }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it("PATCH /api/vault/credentials/[key] upserts when key does not exist yet", async () => {
    const res = await credentialPatch(
      new Request("http://localhost/api/vault/credentials/new-key-never-set", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookieHeader },
        body: JSON.stringify({ value: "first-value" }),
      }),
      { params: Promise.resolve({ key: "new-key-never-set" }) }
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
    const res = await credentialDelete(
      new Request("http://localhost/api/vault/credentials/some-key", { method: "DELETE" }),
      {
        params: Promise.resolve({ key: "some-key" }),
      }
    );
    expect(res.status).toBe(403);
  });

  it("DELETE /api/vault/credentials/[key] returns ok when unlocked", async () => {
    const res = await credentialDelete(
      withCookie(
        new Request("http://localhost/api/vault/credentials/my-key", { method: "DELETE" })
      ),
      { params: Promise.resolve({ key: "my-key" }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it("POST /api/vault/credentials/clear returns 403 when vault locked", async () => {
    const res = await clearPost(
      new Request("http://localhost/api/vault/credentials/clear", { method: "POST" })
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/vault/credentials/clear returns ok and deleted count when unlocked", async () => {
    const res = await clearPost(
      withCookie(new Request("http://localhost/api/vault/credentials/clear", { method: "POST" }))
    );
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

  it("POST /api/vault/credentials/import parses CSV with name,password header", async () => {
    const csv = "name,password\nuser1,secret1\nuser2,secret2";
    const form = new FormData();
    form.append("file", new Blob([csv], { type: "text/csv" }), "import.csv");
    const res = await importPost(
      new Request("http://localhost/api/vault/credentials/import", {
        method: "POST",
        headers: { Cookie: cookieHeader },
        body: form,
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.imported).toBe(2);
    expect(data.total).toBe(2);
  });

  it("POST /api/vault/credentials/import parses CSV with quoted field", async () => {
    const csv = 'key,value\n"quoted,key",val123';
    const form = new FormData();
    form.append("file", new Blob([csv], { type: "text/csv" }), "import.csv");
    const res = await importPost(
      new Request("http://localhost/api/vault/credentials/import", {
        method: "POST",
        headers: { Cookie: cookieHeader },
        body: form,
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.imported).toBe(1);
    expect(data.total).toBe(1);
  });

  it("POST /api/vault/credentials/import parses CSV line with no comma as single cell", async () => {
    const csv = "key,value\nsingle,val\nnocomma";
    const form = new FormData();
    form.append("file", new Blob([csv], { type: "text/csv" }), "import.csv");
    const res = await importPost(
      new Request("http://localhost/api/vault/credentials/import", {
        method: "POST",
        headers: { Cookie: cookieHeader },
        body: form,
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.imported).toBe(1);
    expect(data.total).toBe(1);
  });

  it("POST /api/vault/credentials/import parses CSV with escaped quote inside quoted field", async () => {
    const csv = 'key,value\n"quoted""key",val456';
    const form = new FormData();
    form.append("file", new Blob([csv], { type: "text/csv" }), "import.csv");
    const res = await importPost(
      new Request("http://localhost/api/vault/credentials/import", {
        method: "POST",
        headers: { Cookie: cookieHeader },
        body: form,
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.imported).toBe(1);
    expect(data.total).toBe(1);
  });

  it("POST /api/vault/credentials/import parses CSV with escaped quotes in value", async () => {
    const csv = 'key,value\nmsg,"say ""hello"""';
    const form = new FormData();
    form.append("file", new Blob([csv], { type: "text/csv" }), "import.csv");
    const res = await importPost(
      new Request("http://localhost/api/vault/credentials/import", {
        method: "POST",
        headers: { Cookie: cookieHeader },
        body: form,
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.imported).toBe(1);
    expect(data.total).toBe(1);
  });

  it("POST /api/vault/credentials/import parses CSV with unterminated quoted field", async () => {
    const csv = 'key,value\nk1,"unterminated';
    const form = new FormData();
    form.append("file", new Blob([csv], { type: "text/csv" }), "import.csv");
    const res = await importPost(
      new Request("http://localhost/api/vault/credentials/import", {
        method: "POST",
        headers: { Cookie: cookieHeader },
        body: form,
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.imported).toBe(1);
    expect(data.total).toBe(1);
  });

  it("POST /api/vault/credentials/import reports error when setStoredCredential throws for one entry", async () => {
    const credentialStore = await import("../../app/api/_lib/credential-store");
    const original = credentialStore.setStoredCredential;
    let callCount = 0;
    vi.spyOn(credentialStore, "setStoredCredential").mockImplementation(async (...args) => {
      callCount++;
      if (callCount === 2) throw new Error("storage full");
      return original.apply(credentialStore, args);
    });
    try {
      const res = await importPost(
        new Request("http://localhost/api/vault/credentials/import", {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookieHeader },
          body: JSON.stringify({
            entries: [
              { key: "ok-key", value: "ok-value" },
              { key: "fail-key", value: "fail-value" },
            ],
          }),
        })
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.imported).toBe(1);
      expect(data.total).toBe(2);
      expect(Array.isArray(data.errors)).toBe(true);
      expect(
        data.errors.some((e: string) => e.includes("fail-key") || e.includes("storage full"))
      ).toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("POST /api/vault/credentials/import reports 'failed' when setStoredCredential throws non-Error", async () => {
    const credentialStore = await import("../../app/api/_lib/credential-store");
    vi.spyOn(credentialStore, "setStoredCredential").mockRejectedValueOnce("string throw");
    try {
      const res = await importPost(
        new Request("http://localhost/api/vault/credentials/import", {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookieHeader },
          body: JSON.stringify({ entries: [{ key: "x", value: "y" }] }),
        })
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.imported).toBe(0);
      expect(data.total).toBe(1);
      expect(Array.isArray(data.errors)).toBe(true);
      expect(data.errors.some((e: string) => e.endsWith("failed"))).toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("POST /api/vault/credentials/import treats non-csv non-json file as CSV content", async () => {
    const text = "key,value\nfrom-txt,secret";
    const form = new FormData();
    form.append("file", new Blob([text], { type: "text/plain" }), "data.txt");
    const res = await importPost(
      new Request("http://localhost/api/vault/credentials/import", {
        method: "POST",
        headers: { Cookie: cookieHeader },
        body: form,
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.imported).toBe(1);
    expect(data.total).toBe(1);
  });

  it("POST /api/vault/credentials/import imports from CSV file (multipart)", async () => {
    const csv = "key,value\nmy-service,secret123\nother,pass";
    const form = new FormData();
    form.append("file", new Blob([csv], { type: "text/csv" }), "import.csv");
    const res = await importPost(
      new Request("http://localhost/api/vault/credentials/import", {
        method: "POST",
        headers: { Cookie: cookieHeader },
        body: form,
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.imported).toBe(2);
    expect(data.total).toBe(2);
  });

  it("POST /api/vault/credentials/import returns 400 when no file in multipart", async () => {
    const form = new FormData();
    const res = await importPost(
      new Request("http://localhost/api/vault/credentials/import", {
        method: "POST",
        headers: { Cookie: cookieHeader },
        body: form,
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("No file");
  });

  it("POST /api/vault/credentials/import accepts JSON body with empty entries", async () => {
    const res = await importPost(
      new Request("http://localhost/api/vault/credentials/import", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieHeader },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.imported).toBe(0);
    expect(data.total).toBe(0);
  });

  it("POST /api/vault/credentials/import accepts multipart JSON file with entries array", async () => {
    const json = JSON.stringify({ entries: [{ key: "from-json-file", value: "v1" }] });
    const form = new FormData();
    form.append("file", new Blob([json], { type: "application/json" }), "creds.json");
    const res = await importPost(
      new Request("http://localhost/api/vault/credentials/import", {
        method: "POST",
        headers: { Cookie: cookieHeader },
        body: form,
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.imported).toBe(1);
  });

  it("POST /api/vault/credentials/import accepts multipart JSON file with keys array", async () => {
    const json = JSON.stringify({ keys: ["key-a", "key-b"] });
    const form = new FormData();
    form.append("file", new Blob([json], { type: "application/json" }), "keys.json");
    const res = await importPost(
      new Request("http://localhost/api/vault/credentials/import", {
        method: "POST",
        headers: { Cookie: cookieHeader },
        body: form,
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(2);
    expect(data.imported).toBe(0);
    expect(data.errors).toBeDefined();
  });

  it("POST /api/vault/credentials/import returns 400 for invalid JSON file", async () => {
    const form = new FormData();
    form.append("file", new Blob(["not json"], { type: "application/json" }), "bad.json");
    const res = await importPost(
      new Request("http://localhost/api/vault/credentials/import", {
        method: "POST",
        headers: { Cookie: cookieHeader },
        body: form,
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid JSON");
  });

  it("POST /api/vault/credentials/import skips empty value and reports errors", async () => {
    const res = await importPost(
      new Request("http://localhost/api/vault/credentials/import", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieHeader },
        body: JSON.stringify({
          entries: [
            { key: "valid-key", value: "valid-value" },
            { key: "empty-val", value: "" },
          ],
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.imported).toBe(1);
    expect(data.total).toBe(2);
    expect(Array.isArray(data.errors)).toBe(true);
    expect(
      data.errors.some((e: string) => e.includes("empty value") || e.includes("Skipped"))
    ).toBe(true);
  });
});
