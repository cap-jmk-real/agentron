import { describe, it, expect, vi } from "vitest";
import { POST } from "../../app/api/run-code/route";

const mockCreate = vi.fn().mockResolvedValue("test-runner-container-id");
const mockExec = vi.fn().mockResolvedValue({
  stdout: '{"output":"No main() defined"}',
  stderr: "",
  exitCode: 0,
});

vi.mock("../../app/api/_lib/container-manager", () => ({
  getContainerManager: () => ({
    create: mockCreate,
    exec: mockExec,
  }),
  withContainerInstallHint: (msg: string) => msg,
}));

describe("Run code API", () => {
  it("POST /api/run-code returns 400 when body is not JSON", async () => {
    const res = await POST(
      new Request("http://localhost/api/run-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid JSON");
  });

  it("POST /api/run-code returns 400 when code is missing", async () => {
    const res = await POST(
      new Request("http://localhost/api/run-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("code is required");
  });

  it("POST /api/run-code returns 400 when code is empty string", async () => {
    const res = await POST(
      new Request("http://localhost/api/run-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "" }),
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("code is required");
  });

  it("POST /api/run-code returns 400 when code is whitespace only", async () => {
    const res = await POST(
      new Request("http://localhost/api/run-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "   \n\t  " }),
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("code is required");
  });

  it("POST /api/run-code returns 200 with output when container exec succeeds", async () => {
    mockExec.mockResolvedValueOnce({
      stdout: '{"x":1}',
      stderr: "",
      exitCode: 0,
    });
    const res = await POST(
      new Request("http://localhost/api/run-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: "function main() { return { x: 1 }; }",
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.output).toEqual({ x: 1 });
    expect(data.stdout).toBe('{"x":1}');
    expect(data.stderr).toBe("");
  });

  it("POST /api/run-code returns 500 when exec exitCode is non-zero", async () => {
    mockExec.mockResolvedValueOnce({
      stdout: "some stdout",
      stderr: "Runtime error",
      exitCode: 1,
    });
    const res = await POST(
      new Request("http://localhost/api/run-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "throw new Error('x');" }),
      })
    );
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Runtime error");
    expect(data.stdout).toBe("some stdout");
    expect(data.stderr).toBe("Runtime error");
    expect(data.exitCode).toBe(1);
  });

  it("POST /api/run-code returns 500 with Execution failed when exitCode non-zero and stderr empty", async () => {
    mockExec.mockResolvedValueOnce({
      stdout: "",
      stderr: "",
      exitCode: 2,
    });
    const res = await POST(
      new Request("http://localhost/api/run-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "x" }),
      })
    );
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Execution failed");
    expect(data.exitCode).toBe(2);
  });

  it("POST /api/run-code returns 200 with output as stdout/stderr object when stdout is not valid JSON", async () => {
    mockExec.mockResolvedValueOnce({
      stdout: "plain text output",
      stderr: "",
      exitCode: 0,
    });
    const res = await POST(
      new Request("http://localhost/api/run-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "console.log('hello');" }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.output).toEqual({ stdout: "plain text output", stderr: "" });
    expect(data.stdout).toBe("plain text output");
  });

  it("POST /api/run-code returns 500 with error when exec throws", async () => {
    mockExec.mockRejectedValueOnce(new Error("podman not found"));
    const res = await POST(
      new Request("http://localhost/api/run-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "1+1" }),
      })
    );
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("podman not found");
  });

  it("POST /api/run-code with language python uses python runner and returns output", async () => {
    mockExec.mockResolvedValueOnce({
      stdout: '{"result": 42}',
      stderr: "",
      exitCode: 0,
    });
    const res = await POST(
      new Request("http://localhost/api/run-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: "python", code: "def main(): return 42" }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.output).toEqual({ result: 42 });
  });
});
