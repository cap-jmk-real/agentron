import { describe, it, expect, beforeAll, vi } from "vitest";
import * as db from "../../app/api/_lib/db";
import { GET as exportGet } from "../../app/api/backup/export/route";
import { POST as restorePost } from "../../app/api/backup/restore/route";
import { POST as resetPost } from "../../app/api/backup/reset/route";
import { GET as agentsGet } from "../../app/api/agents/route";
import { POST as agentsPost } from "../../app/api/agents/route";

describe("Backup API", () => {
  beforeAll(async () => {
    // Ensure DB has at least one row so export/restore has content
    const listRes = await agentsGet();
    const list = await listRes.json();
    if (Array.isArray(list) && list.length === 0) {
      await agentsPost(
        new Request("http://localhost/api/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Backup Test Agent",
            kind: "node",
            type: "internal",
            protocol: "native",
            capabilities: [],
            scopes: [],
          }),
        })
      );
    }
  });

  it("GET /api/backup/export returns SQLite file", async () => {
    const res = await exportGet();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("sqlite");
    expect(res.headers.get("Content-Disposition")).toMatch(/attachment.*\.sqlite/);
    const buffer = await res.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
    // SQLite magic header
    const header = new Uint8Array(buffer, 0, 16);
    const magic = "SQLite format 3\0";
    expect(String.fromCharCode(...header.slice(0, 16))).toBe(magic);
  });

  it("GET /api/backup/export returns 500 when runBackup throws", async () => {
    vi.spyOn(db, "runBackup").mockRejectedValueOnce(new Error("backup failed"));
    const res = await exportGet();
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("backup failed");
    vi.restoreAllMocks();
  });

  it("GET /api/backup/export returns 500 with generic message when thrown value is not Error", async () => {
    vi.spyOn(db, "runBackup").mockRejectedValueOnce("string throw");
    const res = await exportGet();
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Export failed");
    vi.restoreAllMocks();
  });

  it("POST /api/backup/restore accepts file and restores", async () => {
    const exportRes = await exportGet();
    expect(exportRes.ok).toBe(true);
    const blob = await exportRes.blob();
    const form = new FormData();
    form.append("file", blob, "backup.sqlite");

    const restoreRes = await restorePost(
      new Request("http://localhost/api/backup/restore", { method: "POST", body: form })
    );
    const data = await restoreRes.json();
    expect(restoreRes.ok).toBe(true);
    expect(data.ok).toBe(true);
    expect(data.message).toBeDefined();
  });

  it("POST /api/backup/restore without file returns 400", async () => {
    const res = await restorePost(
      new Request("http://localhost/api/backup/restore", { method: "POST", body: new FormData() })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("POST /api/backup/restore returns 400 when file field is not a File", async () => {
    const form = new FormData();
    form.append("file", "not-a-file");
    const res = await restorePost(
      new Request("http://localhost/api/backup/restore", { method: "POST", body: form })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("file");
  });

  it("POST /api/backup/reset returns ok and message", async () => {
    const res = await resetPost();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.message).toBeDefined();
  });

  it("POST /api/backup/reset returns 500 when reset throws", async () => {
    vi.spyOn(db, "runReset").mockImplementationOnce(() => {
      throw new Error("reset failed");
    });
    const res = await resetPost();
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("reset failed");
  });
});
