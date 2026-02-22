import { describe, it, expect, vi } from "vitest";
import { GET, PATCH } from "../../app/api/settings/app/route";

describe("Settings app API", () => {
  it("GET /api/settings/app returns default maxFileUploadBytes and workflowMaxSelfFixRetries", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.maxFileUploadBytes).toBe("number");
    expect(data.maxFileUploadBytes).toBeGreaterThanOrEqual(1024 * 1024);
    expect(data.maxFileUploadBytes).toBeLessThanOrEqual(500 * 1024 * 1024);
    expect(typeof data.workflowMaxSelfFixRetries).toBe("number");
    expect(data.workflowMaxSelfFixRetries).toBeGreaterThanOrEqual(0);
    expect(data.workflowMaxSelfFixRetries).toBeLessThanOrEqual(10);
  });

  it("GET /api/settings/app returns web search fields", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(["duckduckgo", "brave", "google"]).toContain(data.webSearchProvider);
    expect(data).toHaveProperty("webSearchProvider");
  });

  it("PATCH /api/settings/app updates maxFileUploadBytes", async () => {
    const getRes = await GET();
    const before = await getRes.json();
    const newBytes = 10 * 1024 * 1024; // 10 MB
    const patchRes = await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxFileUploadBytes: newBytes }),
      })
    );
    expect(patchRes.status).toBe(200);
    const patched = await patchRes.json();
    expect(patched.maxFileUploadBytes).toBe(newBytes);
    const getAfter = await GET();
    const after = await getAfter.json();
    expect(after.maxFileUploadBytes).toBe(newBytes);
    // Restore for other tests
    await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxFileUploadBytes: before.maxFileUploadBytes }),
      })
    );
  });

  it("PATCH /api/settings/app clamps value to 1–500 MB", async () => {
    const tooSmall = await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxFileUploadBytes: 1024 }), // 1 KB
      })
    );
    const small = await tooSmall.json();
    expect(small.maxFileUploadBytes).toBe(1024 * 1024); // clamped to 1 MB

    const tooBig = await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxFileUploadBytes: 1000 * 1024 * 1024 }),
      })
    );
    const big = await tooBig.json();
    expect(big.maxFileUploadBytes).toBe(500 * 1024 * 1024); // clamped to 500 MB

    // Restore default
    await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxFileUploadBytes: 50 * 1024 * 1024 }),
      })
    );
  });

  it("PATCH /api/settings/app updates workflowMaxSelfFixRetries", async () => {
    const getRes = await GET();
    const before = await getRes.json();
    const patchRes = await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowMaxSelfFixRetries: 5 }),
      })
    );
    expect(patchRes.status).toBe(200);
    const patched = await patchRes.json();
    expect(patched.workflowMaxSelfFixRetries).toBe(5);
    await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowMaxSelfFixRetries: before.workflowMaxSelfFixRetries }),
      })
    );
  });

  it("PATCH /api/settings/app with invalid body leaves settings unchanged", async () => {
    const getRes = await GET();
    const before = await getRes.json();
    const res = await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.maxFileUploadBytes).toBe(before.maxFileUploadBytes);
  });

  it("PATCH /api/settings/app updates containerEngine", async () => {
    const getRes = await GET();
    const before = await getRes.json();
    const engine = before.containerEngine === "podman" ? "docker" : "podman";
    const patchRes = await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ containerEngine: engine }),
      })
    );
    expect(patchRes.status).toBe(200);
    const patched = await patchRes.json();
    expect(patched.containerEngine).toBe(engine);
    await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ containerEngine: before.containerEngine }),
      })
    );
  });

  it("PATCH /api/settings/app updates shellCommandAllowlist", async () => {
    const patchRes = await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shellCommandAllowlist: ["echo", "ls"] }),
      })
    );
    expect(patchRes.status).toBe(200);
    const data = await patchRes.json();
    expect(data.shellCommandAllowlist).toEqual(["echo", "ls"]);
  });

  it("PATCH /api/settings/app filters empty and non-string from shellCommandAllowlist", async () => {
    const patchRes = await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shellCommandAllowlist: ["valid", "", "  ", "x", 123],
        }),
      })
    );
    expect(patchRes.status).toBe(200);
    const data = await patchRes.json();
    expect(data.shellCommandAllowlist).toEqual(["valid", "x"]);
  });

  it("PATCH /api/settings/app addShellCommand adds single command", async () => {
    const patchRes = await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addShellCommand: "whoami" }),
      })
    );
    expect(patchRes.status).toBe(200);
    const data = await patchRes.json();
    expect(data.addedCommands).toEqual(["whoami"]);
  });

  it("PATCH /api/settings/app addShellCommand with compound command adds both full and parts", async () => {
    const patchRes = await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addShellCommand: "echo a && echo b" }),
      })
    );
    expect(patchRes.status).toBe(200);
    const data = await patchRes.json();
    expect(Array.isArray(data.addedCommands)).toBe(true);
    expect(data.addedCommands.length).toBeGreaterThanOrEqual(1);
  });

  it("PATCH /api/settings/app addShellCommand does not split separator inside double quotes", async () => {
    const patchRes = await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addShellCommand: 'echo "a && b"' }),
      })
    );
    expect(patchRes.status).toBe(200);
    const data = await patchRes.json();
    expect(Array.isArray(data.addedCommands)).toBe(true);
    expect(data.addedCommands.some((c: string) => c.includes('"a && b"'))).toBe(true);
  });

  it("PATCH /api/settings/app addShellCommand splits on separator and skips empty part", async () => {
    const patchRes = await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addShellCommand: " & echo after-amp" }),
      })
    );
    expect(patchRes.status).toBe(200);
    const data = await patchRes.json();
    expect(Array.isArray(data.addedCommands)).toBe(true);
    expect(data.addedCommands.some((c: string) => c.includes("echo after-amp"))).toBe(true);
  });

  it("PATCH /api/settings/app addShellCommand does not split separator inside single quotes", async () => {
    const patchRes = await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addShellCommand: "echo 'a && b'" }),
      })
    );
    expect(patchRes.status).toBe(200);
    const data = await patchRes.json();
    expect(Array.isArray(data.addedCommands)).toBe(true);
    expect(data.addedCommands.some((c: string) => c.includes("a && b"))).toBe(true);
  });

  it("PATCH /api/settings/app ignores maxFileUploadBytes when NaN", async () => {
    const getRes = await GET();
    const before = await getRes.json();
    const patchRes = await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxFileUploadBytes: "not a number" }),
      })
    );
    expect(patchRes.status).toBe(200);
    const data = await patchRes.json();
    expect(data.maxFileUploadBytes).toBe(before.maxFileUploadBytes);
  });

  it("PATCH /api/settings/app addShellCommand when command already in allowlist does not duplicate", async () => {
    await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addShellCommand: "existing-cmd-xyz" }),
      })
    );
    const patchRes = await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addShellCommand: "existing-cmd-xyz" }),
      })
    );
    expect(patchRes.status).toBe(200);
    const data = await patchRes.json();
    expect(data.addedCommands == null || data.addedCommands.length === 0).toBe(true);
  });

  it("PATCH /api/settings/app addShellCommand with whitespace-only adds nothing", async () => {
    const patchRes = await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addShellCommand: "   \t  " }),
      })
    );
    expect(patchRes.status).toBe(200);
    const data = await patchRes.json();
    expect(data.addedCommands == null || data.addedCommands.length === 0).toBe(true);
  });

  it("PATCH /api/settings/app accepts workflowMaxSelfFixRetries 0", async () => {
    const patchRes = await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowMaxSelfFixRetries: 0 }),
      })
    );
    expect(patchRes.status).toBe(200);
    const data = await patchRes.json();
    expect(data.workflowMaxSelfFixRetries).toBe(0);
  });

  it("PATCH /api/settings/app ignores workflowMaxSelfFixRetries out of range", async () => {
    const getRes = await GET();
    const before = await getRes.json();
    const patchRes = await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowMaxSelfFixRetries: 11 }),
      })
    );
    expect(patchRes.status).toBe(200);
    const data = await patchRes.json();
    expect(data.workflowMaxSelfFixRetries).toBe(before.workflowMaxSelfFixRetries);
  });

  it("PATCH /api/settings/app updates web search provider and keys", async () => {
    const getRes = await GET();
    const before = await getRes.json();
    const patchRes = await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webSearchProvider: "brave",
          braveSearchApiKey: "brave-key",
        }),
      })
    );
    expect(patchRes.status).toBe(200);
    const data = await patchRes.json();
    expect(data.webSearchProvider).toBe("brave");
    expect(data.braveSearchApiKey).toBe("brave-key");
    await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webSearchProvider: "google",
          googleCseKey: "gkey",
          googleCseCx: "gcx-id",
        }),
      })
    );
    const after = (await GET()).json();
    const afterData = await after;
    expect(afterData.webSearchProvider).toBe("google");
    expect(afterData.googleCseKey).toBe("gkey");
    expect(afterData.googleCseCx).toBe("gcx-id");
    await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webSearchProvider: before.webSearchProvider,
          braveSearchApiKey: before.braveSearchApiKey,
          googleCseKey: before.googleCseKey,
          googleCseCx: before.googleCseCx,
        }),
      })
    );
  });

  it("PATCH /api/settings/app trims web search keys and ignores non-string", async () => {
    await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webSearchProvider: "google", googleCseKey: "prior" }),
      })
    );
    const patchRes = await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webSearchProvider: "brave",
          braveSearchApiKey: "  trimmed  ",
          googleCseKey: 123,
        }),
      })
    );
    expect(patchRes.status).toBe(200);
    const data = await patchRes.json();
    expect(data.webSearchProvider).toBe("brave");
    expect(data.braveSearchApiKey).toBe("trimmed");
    expect(data.googleCseKey).toBe("prior");
  });

  it("PATCH /api/settings/app ignores non-string braveSearchApiKey and googleCseCx", async () => {
    await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webSearchProvider: "google",
          googleCseKey: "key",
          googleCseCx: "cx-id",
        }),
      })
    );
    const patchRes = await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          braveSearchApiKey: 999,
          googleCseCx: 123,
        }),
      })
    );
    expect(patchRes.status).toBe(200);
    const data = await patchRes.json();
    expect(data.braveSearchApiKey).not.toBe(999);
    expect(data.googleCseKey).toBe("key");
    expect(data.googleCseCx).not.toBe(123);
  });

  it("PATCH /api/settings/app accepts whitespace-only googleCseCx (trim branch)", async () => {
    const patchRes = await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ googleCseCx: "   \t  " }),
      })
    );
    expect(patchRes.status).toBe(200);
  });

  it("PATCH /api/settings/app accepts whitespace-only braveSearchApiKey (trim to undefined branch)", async () => {
    await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webSearchProvider: "brave", braveSearchApiKey: "key" }),
      })
    );
    const patchRes = await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ braveSearchApiKey: "   \t  " }),
      })
    );
    expect(patchRes.status).toBe(200);
  });

  it("PATCH /api/settings/app accepts whitespace-only googleCseKey (trim to undefined branch)", async () => {
    await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webSearchProvider: "google", googleCseKey: "k", googleCseCx: "cx" }),
      })
    );
    const patchRes = await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ googleCseKey: "   " }),
      })
    );
    expect(patchRes.status).toBe(200);
  });

  it("PATCH /api/settings/app ignores invalid webSearchProvider", async () => {
    const getRes = await GET();
    const before = await getRes.json();
    const patchRes = await PATCH(
      new Request("http://localhost/api/settings/app", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webSearchProvider: "invalid" }),
      })
    );
    expect(patchRes.status).toBe(200);
    const data = await patchRes.json();
    expect(data.webSearchProvider).toBe(before.webSearchProvider);
  });

  it("GET /api/settings/app returns 500 when getAppSettings throws", async () => {
    const mod = await import("../../app/api/_lib/app-settings");
    const spy = vi.spyOn(mod, "getAppSettings").mockImplementationOnce(() => {
      throw new Error("load fail");
    });
    try {
      const res = await GET();
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe("load fail");
    } finally {
      spy.mockRestore();
    }
  });

  it("GET /api/settings/app returns 500 when verifyContainerEngine throws", async () => {
    const mod = await import("../../app/api/_lib/container-manager");
    const spy = vi
      .spyOn(mod, "verifyContainerEngine")
      .mockRejectedValueOnce(new Error("engine fail"));
    try {
      const res = await GET();
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe("engine fail");
    } finally {
      spy.mockRestore();
    }
  });

  it("GET /api/settings/app returns 500 with generic message when getAppSettings throws non-Error", async () => {
    const mod = await import("../../app/api/_lib/app-settings");
    const spy = vi.spyOn(mod, "getAppSettings").mockImplementationOnce(() => {
      throw "string error";
    });
    try {
      const res = await GET();
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe("Failed to load settings");
    } finally {
      spy.mockRestore();
    }
  });

  it("PATCH /api/settings/app returns 500 with generic message when thrown value is not Error", async () => {
    const mod = await import("../../app/api/_lib/app-settings");
    const spy = vi.spyOn(mod, "updateAppSettings").mockImplementationOnce(() => {
      throw "string";
    });
    try {
      const res = await PATCH(
        new Request("http://localhost/api/settings/app", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        })
      );
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe("Failed to update settings");
    } finally {
      spy.mockRestore();
    }
  });
});
