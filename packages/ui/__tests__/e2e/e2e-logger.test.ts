import { describe, it, expect } from "vitest";
import { formatAttacksAndCommands, type ExecutionLogEntryForFormat } from "./e2e-logger";

describe("formatAttacksAndCommands", () => {
  function entry(
    phase: string,
    label: string,
    payload: Record<string, unknown>
  ): ExecutionLogEntryForFormat {
    return { phase, label, payload: JSON.stringify(payload) };
  }

  it("formats std-fetch-url with method and url", () => {
    const log: ExecutionLogEntryForFormat[] = [
      entry("tool_call", "std-fetch-url", {
        toolId: "std-fetch-url",
        input: { url: "http://127.0.0.1:18200", method: "GET", headers: {}, body: "" },
      }),
      entry("tool_result", "std-fetch-url", { toolId: "std-fetch-url", result: { status: 200 } }),
    ];
    const out = formatAttacksAndCommands(log);
    expect(out).toContain("[std-fetch-url] GET http://127.0.0.1:18200");
    expect(out).toContain("→ status 200");
  });

  it("formats std-http-request with headers (e.g. Shellshock User-Agent)", () => {
    const log: ExecutionLogEntryForFormat[] = [
      entry("tool_call", "std-http-request", {
        toolId: "std-http-request",
        input: {
          method: "GET",
          url: "http://127.0.0.1:18200/cgi-bin/vulnerable",
          headers: { "User-Agent": "() { :; }; echo; cat /etc/passwd" },
          body: "",
        },
      }),
      entry("tool_result", "std-http-request", {
        toolId: "std-http-request",
        result: {
          error: "HTTP request failed",
          message: "Request with GET/HEAD method cannot have body.",
        },
      }),
    ];
    const out = formatAttacksAndCommands(log);
    expect(out).toContain("[std-http-request] GET http://127.0.0.1:18200/cgi-bin/vulnerable");
    expect(out).toContain('"User-Agent":"() { :; }; echo; cat /etc/passwd"');
    expect(out).toContain("→ error: HTTP request failed");
  });

  it("formats std-execute-code with command and sandboxId", () => {
    const log: ExecutionLogEntryForFormat[] = [
      entry("tool_call", "std-execute-code", {
        toolId: "std-execute-code",
        input: {
          sandboxId: "3c2148fa-feec-40a2-989c-596a77231467",
          command: "tail -50 /var/log/apache2/access.log",
        },
      }),
      entry("tool_result", "std-execute-code", {
        toolId: "std-execute-code",
        result: { stdout: "10.88.0.1 - - ...", stderr: "", exitCode: 0 },
      }),
    ];
    const out = formatAttacksAndCommands(log);
    expect(out).toContain("[std-execute-code]");
    expect(out).toContain("(sandbox 3c2148fa…)");
    expect(out).toContain("tail -50 /var/log/apache2/access.log");
    expect(out).toContain("→ exit 0");
  });

  it("formats std-list-sandboxes", () => {
    const log: ExecutionLogEntryForFormat[] = [
      entry("tool_call", "std-list-sandboxes", { toolId: "std-list-sandboxes", input: {} }),
      entry("tool_result", "std-list-sandboxes", {
        toolId: "std-list-sandboxes",
        result: [{ id: "abc", name: "red-blue-target" }],
      }),
    ];
    const out = formatAttacksAndCommands(log);
    expect(out).toContain("[std-list-sandboxes]");
    expect(out).toContain("→ ok");
  });

  it("returns (no tool calls) for empty log", () => {
    expect(formatAttacksAndCommands([])).toBe("(no tool calls)");
  });

  it("skips non-tool phases", () => {
    const log: ExecutionLogEntryForFormat[] = [
      { phase: "llm_request", label: null, payload: null },
      {
        phase: "tool_call",
        label: "std-fetch-url",
        payload: JSON.stringify({
          toolId: "std-fetch-url",
          input: { url: "http://x", method: "GET" },
        }),
      },
      {
        phase: "tool_result",
        label: "std-fetch-url",
        payload: JSON.stringify({ toolId: "std-fetch-url", result: {} }),
      },
    ];
    const out = formatAttacksAndCommands(log);
    expect(out).toContain("[std-fetch-url] GET http://x");
    expect(out).not.toContain("llm_request");
  });

  it("handles double-encoded payload string", () => {
    const log: ExecutionLogEntryForFormat[] = [
      {
        phase: "tool_call",
        label: "std-execute-code",
        payload: JSON.stringify(
          JSON.stringify({ toolId: "std-execute-code", input: { command: "id", sandboxId: "abc" } })
        ),
      },
    ];
    const out = formatAttacksAndCommands(log);
    expect(out).toContain("[std-execute-code]");
    expect(out).toContain("id");
  });
});
