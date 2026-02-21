import { describe, it, expect, vi } from "vitest";
import { POST } from "../../app/api/shell-command/execute/route";
import { runShellCommand } from "../../app/api/_lib/shell-exec";

vi.mock("../../app/api/_lib/shell-exec", () => ({
  runShellCommand: vi.fn().mockResolvedValue({ stdout: "hello", stderr: "", exitCode: 0 }),
}));

describe("Shell command execute API", () => {
  it("POST /api/shell-command/execute returns stdout, stderr, exitCode when command provided", async () => {
    const res = await POST(
      new Request("http://localhost/api/shell-command/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "echo hello" }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.stdout).toBe("hello");
    expect(data.stderr).toBe("");
    expect(data.exitCode).toBe(0);
  });

  it("POST /api/shell-command/execute returns 400 when command missing", async () => {
    const res = await POST(
      new Request("http://localhost/api/shell-command/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("command");
  });

  it("POST /api/shell-command/execute returns 400 when command empty string", async () => {
    const res = await POST(
      new Request("http://localhost/api/shell-command/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "   " }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/shell-command/execute returns 400 when body is not valid JSON", async () => {
    const res = await POST(
      new Request("http://localhost/api/shell-command/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not valid json",
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("command");
  });

  it("POST /api/shell-command/execute returns 500 when runShellCommand throws", async () => {
    vi.mocked(runShellCommand).mockRejectedValueOnce(new Error("Exec failed"));
    const res = await POST(
      new Request("http://localhost/api/shell-command/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "echo fail" }),
      })
    );
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("POST /api/shell-command/execute returns 500 with generic message when throw is not Error", async () => {
    vi.mocked(runShellCommand).mockRejectedValueOnce("string error");
    const res = await POST(
      new Request("http://localhost/api/shell-command/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "echo fail" }),
      })
    );
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Failed to execute command");
  });
});
