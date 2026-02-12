import { describe, it, expect } from "vitest";
import { GET as listGet, POST as listPost } from "../../app/api/files/route";

describe("Files API", () => {
  it("GET /api/files returns array", async () => {
    const res = await listGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("POST /api/files without file returns 400", async () => {
    const form = new FormData();
    const res = await listPost(
      new Request("http://localhost/api/files", { method: "POST", body: form })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("POST /api/files returns 413 when file exceeds 50MB", async () => {
    const form = new FormData();
    const bigBlob = new Blob([new Uint8Array(50 * 1024 * 1024 + 1)]);
    form.append("file", bigBlob, "big.bin");
    const res = await listPost(
      new Request("http://localhost/api/files", { method: "POST", body: form })
    );
    expect(res.status).toBe(413);
    const data = await res.json();
    expect(data.error).toContain("large");
  });

  it("POST /api/files with file creates entry", async () => {
    const form = new FormData();
    const blob = new Blob(["hello"], { type: "text/plain" });
    form.append("file", blob, "hello.txt");

    const res = await listPost(
      new Request("http://localhost/api/files", { method: "POST", body: form })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.name).toBe("hello.txt");
    expect(data.mimeType).toBe("text/plain");
  });
});
