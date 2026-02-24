import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { GET as listGet, POST as listPost } from "../../app/api/files/route";
import { GET as getOne, DELETE as deleteOne } from "../../app/api/files/[id]/route";
import { db, files } from "../../app/api/_lib/db";

describe("Files [id] API", () => {
  let fileId: string;

  it("GET /api/files/:id returns 404 for unknown id", async () => {
    const res = await getOne(new Request("http://localhost/api/files/unknown-id"), {
      params: Promise.resolve({ id: "unknown-id" }),
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Not found");
  });

  it("GET /api/files/:id?meta=true returns file metadata", async () => {
    const form = new FormData();
    const blob = new Blob(["meta test"], { type: "text/plain" });
    form.append("file", blob, "meta.txt");
    const createRes = await listPost(
      new Request("http://localhost/api/files", { method: "POST", body: form })
    );
    const created = await createRes.json();
    fileId = created.id;

    const res = await getOne(new Request("http://localhost/api/files/x?meta=true"), {
      params: Promise.resolve({ id: fileId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(fileId);
    expect(data.name).toBe("meta.txt");
    expect(data.mimeType).toBe("text/plain");
  });

  it("GET /api/files/:id without meta returns file content", async () => {
    const res = await getOne(new Request("http://localhost/api/files/x"), {
      params: Promise.resolve({ id: fileId }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain");
    const text = await res.text();
    expect(text).toBe("meta test");
  });

  it("GET /api/files/:id returns 404 when file missing from disk", async () => {
    const missingId = crypto.randomUUID();
    await db
      .insert(files)
      .values({
        id: missingId,
        name: "missing.txt",
        mimeType: "text/plain",
        size: 0,
        path: `nonexistent-${missingId}.txt`,
        createdAt: Date.now(),
      })
      .run();
    const res = await getOne(new Request("http://localhost/api/files/x"), {
      params: Promise.resolve({ id: missingId }),
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("File missing from disk");
    await db.delete(files).where(eq(files.id, missingId)).run();
  });

  it("DELETE /api/files/:id returns 404 for unknown id", async () => {
    const res = await deleteOne(new Request("http://localhost/api/files/x", { method: "DELETE" }), {
      params: Promise.resolve({ id: "unknown-id" }),
    });
    expect(res.status).toBe(404);
  });

  it("DELETE /api/files/:id removes file", async () => {
    const res = await deleteOne(new Request("http://localhost/api/files/x", { method: "DELETE" }), {
      params: Promise.resolve({ id: fileId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    const getRes = await getOne(new Request("http://localhost/api/files/x"), {
      params: Promise.resolve({ id: fileId }),
    });
    expect(getRes.status).toBe(404);
  });

  it("DELETE /api/files/:id returns ok when file row exists but file missing from disk", async () => {
    const orphanId = crypto.randomUUID();
    await db
      .insert(files)
      .values({
        id: orphanId,
        name: "orphan.txt",
        mimeType: "text/plain",
        size: 0,
        path: `orphan-${orphanId}.txt`,
        createdAt: Date.now(),
      })
      .run();
    const res = await deleteOne(new Request("http://localhost/api/files/x", { method: "DELETE" }), {
      params: Promise.resolve({ id: orphanId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    const getRes = await getOne(new Request("http://localhost/api/files/x"), {
      params: Promise.resolve({ id: orphanId }),
    });
    expect(getRes.status).toBe(404);
  });
});
