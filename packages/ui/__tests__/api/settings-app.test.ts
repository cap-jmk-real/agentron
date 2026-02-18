import { describe, it, expect } from "vitest";
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
});
