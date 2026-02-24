import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as executePost } from "../../app/api/functions/[id]/execute/route";
import { POST as fnPost } from "../../app/api/functions/route";
import { db, customFunctions, sandboxes } from "../../app/api/_lib/db";
import { eq } from "drizzle-orm";

const mockExec = vi.fn();
vi.mock("../../app/api/_lib/container-manager", () => ({
  getContainerManager: () => ({ exec: (...args: unknown[]) => mockExec(...args) }),
}));

describe("Functions execute API", () => {
  beforeEach(() => {
    mockExec.mockReset();
  });
  it("POST /api/functions/:id/execute returns 404 for unknown function id", async () => {
    const res = await executePost(
      new Request("http://localhost/api/functions/non-existent-id/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: {} }),
      }),
      { params: Promise.resolve({ id: "non-existent-id" }) }
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain("Function not found");
  });

  it("POST /api/functions/:id/execute returns 400 when function has no sandbox", async () => {
    const createRes = await fnPost(
      new Request("http://localhost/api/functions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "NoSandboxFn",
          language: "javascript",
          source: "function main() { return 1; }",
        }),
      })
    );
    expect(createRes.status).toBe(201);
    const fn = await createRes.json();
    const res = await executePost(
      new Request(`http://localhost/api/functions/${fn.id}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: {} }),
      }),
      { params: Promise.resolve({ id: fn.id }) }
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/sandbox|No sandbox/i);
  });

  it("POST /api/functions/:id/execute accepts payload without input and uses null", async () => {
    const createRes = await fnPost(
      new Request("http://localhost/api/functions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "NoInputFn",
          language: "javascript",
          source: "function main() { return null; }",
        }),
      })
    );
    expect(createRes.status).toBe(201);
    const fn = await createRes.json();
    const res = await executePost(
      new Request(`http://localhost/api/functions/${fn.id}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: fn.id }) }
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("POST /api/functions/:id/execute runs python function when sandbox has containerId", async () => {
    const sandboxId = "exec-sb-" + Date.now();
    const fnId = "exec-fn-py-" + Date.now();
    await db
      .insert(sandboxes)
      .values({
        id: sandboxId,
        name: "exec-test",
        image: "python:3-slim",
        status: "running",
        containerId: "cid-123",
        config: "{}",
        createdAt: Date.now(),
      })
      .run();
    await db
      .insert(customFunctions)
      .values({
        id: fnId,
        name: "PyFn",
        language: "python",
        source: "def main(x): return x",
        sandboxId,
        createdAt: Date.now(),
      })
      .run();
    mockExec.mockResolvedValueOnce({ output: '{"ok":true}' });
    try {
      const res = await executePost(
        new Request(`http://localhost/api/functions/${fnId}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: { x: 1 } }),
        }),
        { params: Promise.resolve({ id: fnId }) }
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toMatchObject({ output: '{"ok":true}' });
      expect(mockExec).toHaveBeenCalledWith("cid-123", expect.stringContaining("python3 -c"));
    } finally {
      await db.delete(customFunctions).where(eq(customFunctions.id, fnId)).run();
      await db.delete(sandboxes).where(eq(sandboxes.id, sandboxId)).run();
    }
  });

  it("POST /api/functions/:id/execute runs typescript/javascript function", async () => {
    const sandboxId = "exec-sb-ts-" + Date.now();
    const fnId = "exec-fn-ts-" + Date.now();
    await db
      .insert(sandboxes)
      .values({
        id: sandboxId,
        name: "exec-ts",
        image: "node:22-slim",
        status: "running",
        containerId: "cid-ts",
        config: "{}",
        createdAt: Date.now(),
      })
      .run();
    await db
      .insert(customFunctions)
      .values({
        id: fnId,
        name: "TsFn",
        language: "typescript",
        source: "export function main(i: unknown) { return i; }",
        sandboxId,
        createdAt: Date.now(),
      })
      .run();
    mockExec.mockResolvedValueOnce({ output: "{}" });
    try {
      const res = await executePost(
        new Request(`http://localhost/api/functions/${fnId}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: {} }),
        }),
        { params: Promise.resolve({ id: fnId }) }
      );
      expect(res.status).toBe(200);
      expect(mockExec).toHaveBeenCalledWith("cid-ts", expect.stringContaining("node -e"));
    } finally {
      await db.delete(customFunctions).where(eq(customFunctions.id, fnId)).run();
      await db.delete(sandboxes).where(eq(sandboxes.id, sandboxId)).run();
    }
  });

  it("POST /api/functions/:id/execute uses default command for unsupported language", async () => {
    const sandboxId = "exec-sb-def-" + Date.now();
    const fnId = "exec-fn-def-" + Date.now();
    await db
      .insert(sandboxes)
      .values({
        id: sandboxId,
        name: "exec-def",
        image: "alpine",
        status: "running",
        containerId: "cid-def",
        config: "{}",
        createdAt: Date.now(),
      })
      .run();
    await db
      .insert(customFunctions)
      .values({
        id: fnId,
        name: "RubyFn",
        language: "ruby",
        source: "def main; 1; end",
        sandboxId,
        createdAt: Date.now(),
      })
      .run();
    mockExec.mockResolvedValueOnce({ output: "Unsupported language: ruby" });
    try {
      const res = await executePost(
        new Request(`http://localhost/api/functions/${fnId}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: null }),
        }),
        { params: Promise.resolve({ id: fnId }) }
      );
      expect(res.status).toBe(200);
      expect(mockExec).toHaveBeenCalledWith(
        "cid-def",
        expect.stringMatching(/Unsupported language: ruby/)
      );
    } finally {
      await db.delete(customFunctions).where(eq(customFunctions.id, fnId)).run();
      await db.delete(sandboxes).where(eq(sandboxes.id, sandboxId)).run();
    }
  });

  it("POST /api/functions/:id/execute returns 500 when container exec throws", async () => {
    const sandboxId = "exec-sb-err-" + Date.now();
    const fnId = "exec-fn-err-" + Date.now();
    await db
      .insert(sandboxes)
      .values({
        id: sandboxId,
        name: "exec-err",
        image: "node:22-slim",
        status: "running",
        containerId: "cid-err",
        config: "{}",
        createdAt: Date.now(),
      })
      .run();
    await db
      .insert(customFunctions)
      .values({
        id: fnId,
        name: "ErrFn",
        language: "javascript",
        source: "function main() {}",
        sandboxId,
        createdAt: Date.now(),
      })
      .run();
    mockExec.mockRejectedValueOnce(new Error("Container exec failed"));
    try {
      const res = await executePost(
        new Request(`http://localhost/api/functions/${fnId}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: {} }),
        }),
        { params: Promise.resolve({ id: fnId }) }
      );
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe("Container exec failed");
    } finally {
      await db.delete(customFunctions).where(eq(customFunctions.id, fnId)).run();
      await db.delete(sandboxes).where(eq(sandboxes.id, sandboxId)).run();
    }
  });

  it("POST /api/functions/:id/execute returns 500 with string when thrown value is not Error", async () => {
    const sandboxId = "exec-sb-str-" + Date.now();
    const fnId = "exec-fn-str-" + Date.now();
    await db
      .insert(sandboxes)
      .values({
        id: sandboxId,
        name: "exec-str",
        image: "node:22-slim",
        status: "running",
        containerId: "cid-str",
        config: "{}",
        createdAt: Date.now(),
      })
      .run();
    await db
      .insert(customFunctions)
      .values({
        id: fnId,
        name: "StrFn",
        language: "javascript",
        source: "function main() {}",
        sandboxId,
        createdAt: Date.now(),
      })
      .run();
    mockExec.mockRejectedValueOnce("plain string throw");
    try {
      const res = await executePost(
        new Request(`http://localhost/api/functions/${fnId}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: {} }),
        }),
        { params: Promise.resolve({ id: fnId }) }
      );
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe("plain string throw");
    } finally {
      await db.delete(customFunctions).where(eq(customFunctions.id, fnId)).run();
      await db.delete(sandboxes).where(eq(sandboxes.id, sandboxId)).run();
    }
  });
});
