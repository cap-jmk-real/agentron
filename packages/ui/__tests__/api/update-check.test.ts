import { describe, it, expect, vi, afterEach } from "vitest";
import { GET } from "../../app/api/update-check/route";

describe("Update check API", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("GET /api/update-check returns available: false when no app version env", async () => {
    const orig = process.env.AGENTRON_APP_VERSION;
    delete process.env.AGENTRON_APP_VERSION;
    const origNpm = process.env.npm_package_version;
    delete process.env.npm_package_version;
    try {
      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.available).toBe(false);
    } finally {
      if (orig !== undefined) process.env.AGENTRON_APP_VERSION = orig;
      if (origNpm !== undefined) process.env.npm_package_version = origNpm;
    }
  });

  it("GET /api/update-check uses npm_package_version when AGENTRON_APP_VERSION unset", async () => {
    const orig = process.env.AGENTRON_APP_VERSION;
    delete process.env.AGENTRON_APP_VERSION;
    process.env.npm_package_version = "0.0.1";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ tag_name: "v0.0.2", html_url: "https://example.com", body: null }),
      })
    );
    try {
      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.available).toBe(true);
      expect(data.version).toBe("0.0.2");
    } finally {
      if (orig !== undefined) process.env.AGENTRON_APP_VERSION = orig;
      delete process.env.npm_package_version;
    }
  });

  it("GET /api/update-check returns available: false when GitHub fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    process.env.AGENTRON_APP_VERSION = "0.1.0";
    try {
      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.available).toBe(false);
    } finally {
      delete process.env.AGENTRON_APP_VERSION;
    }
  });

  it("GET /api/update-check returns available: false when GitHub returns non-ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    process.env.AGENTRON_APP_VERSION = "0.1.0";
    try {
      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.available).toBe(false);
    } finally {
      delete process.env.AGENTRON_APP_VERSION;
    }
  });

  it("GET /api/update-check returns available: false when tag_name missing or not string", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tag_name: 123 }),
      })
    );
    process.env.AGENTRON_APP_VERSION = "0.1.0";
    try {
      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.available).toBe(false);
    } finally {
      delete process.env.AGENTRON_APP_VERSION;
    }
  });

  it("GET /api/update-check returns available: false when latest not greater than current", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ tag_name: "v0.1.0", html_url: "https://example.com", body: null }),
      })
    );
    process.env.AGENTRON_APP_VERSION = "0.1.0";
    try {
      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.available).toBe(false);
    } finally {
      delete process.env.AGENTRON_APP_VERSION;
    }
  });

  it("GET /api/update-check returns available: false when tag is not valid semver", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tag_name: "not-a-version", html_url: "https://example.com" }),
      })
    );
    process.env.AGENTRON_APP_VERSION = "0.1.0";
    try {
      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.available).toBe(false);
    } finally {
      delete process.env.AGENTRON_APP_VERSION;
    }
  });

  it("GET /api/update-check returns available: true when latest greater than current (major)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            tag_name: "v1.0.0",
            html_url: "https://github.com/example/repo/releases/tag/v1.0.0",
            body: "Release notes",
          }),
      })
    );
    process.env.AGENTRON_APP_VERSION = "0.1.0";
    try {
      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.available).toBe(true);
      expect(data.version).toBe("1.0.0");
      expect(data.releaseNotes).toBe("Release notes");
    } finally {
      delete process.env.AGENTRON_APP_VERSION;
    }
  });

  it("GET /api/update-check returns available: true when minor is greater", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            tag_name: "v0.2.0",
            html_url: "https://github.com/example/repo/releases/tag/v0.2.0",
            body: null,
          }),
      })
    );
    process.env.AGENTRON_APP_VERSION = "0.1.0";
    try {
      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.available).toBe(true);
      expect(data.version).toBe("0.2.0");
    } finally {
      delete process.env.AGENTRON_APP_VERSION;
    }
  });

  it("GET /api/update-check returns available: true when patch is greater", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            tag_name: "v0.1.1",
            html_url: "https://github.com/example/repo/releases/tag/v0.1.1",
          }),
      })
    );
    process.env.AGENTRON_APP_VERSION = "0.1.0";
    try {
      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.available).toBe(true);
      expect(data.version).toBe("0.1.1");
    } finally {
      delete process.env.AGENTRON_APP_VERSION;
    }
  });

  it("GET /api/update-check uses fallback url when html_url missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            tag_name: "v2.0.0",
            body: "Notes",
          }),
      })
    );
    process.env.AGENTRON_APP_VERSION = "0.1.0";
    try {
      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.available).toBe(true);
      expect(data.version).toBe("2.0.0");
      expect(data.url).toContain("github.com");
      expect(data.url).toContain("v2.0.0");
    } finally {
      delete process.env.AGENTRON_APP_VERSION;
    }
  });
});
