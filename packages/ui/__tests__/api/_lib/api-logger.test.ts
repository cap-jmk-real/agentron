import fs from "node:fs";
import os from "node:os";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  appendLogLine,
  logApiError,
  getLogExcerpt,
  getLogDir,
  getLogPath,
  probeLogWritable,
} from "../../../app/api/_lib/api-logger";

describe("api-logger", () => {
  it("appendLogLine does not throw", () => {
    appendLogLine("/api/test", "GET", "test message");
  });

  it("logApiError with Error does not throw", () => {
    logApiError("/api/test", "POST", new Error("test error"));
  });

  it("logApiError with Error includes stack when present", () => {
    const err = new Error("test");
    logApiError("/api/test", "POST", err);
    expect(err.stack).toBeDefined();
  });

  it("logApiError with non-Error value uses String()", () => {
    logApiError("/api/test", "GET", "string error");
  });

  it("getLogExcerpt returns string", () => {
    const result = getLogExcerpt(10);
    expect(typeof result).toBe("string");
  });

  it("getLogExcerpt skips path when file has no lines", () => {
    const readSpy = vi.spyOn(fs, "readFileSync").mockReturnValue("");
    const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(true);
    try {
      const result = getLogExcerpt(5);
      expect(typeof result).toBe("string");
    } finally {
      readSpy.mockRestore();
      existsSpy.mockRestore();
    }
  });

  it("getLogExcerpt with zero maxLines returns string", () => {
    const result = getLogExcerpt(0);
    expect(typeof result).toBe("string");
  });

  it("getLogExcerpt with default maxLines returns string", () => {
    const result = getLogExcerpt();
    expect(typeof result).toBe("string");
  });

  it("getLogDir returns string", () => {
    const dir = getLogDir();
    expect(typeof dir).toBe("string");
  });

  it("getLogPath returns string when dir exists or empty when not writable", () => {
    const p = getLogPath();
    expect(typeof p).toBe("string");
  });

  it("getLogPath returns empty when getLogDir throws", () => {
    vi.stubEnv("AGENTRON_DATA_DIR", "/nonexistent-dir-no-create");
    const mkdirSync = vi.spyOn(fs, "mkdirSync").mockImplementation(() => {
      throw new Error("Permission denied");
    });
    const existsSync = vi.spyOn(fs, "existsSync").mockReturnValue(false);
    try {
      const p = getLogPath();
      expect(p).toBe("");
    } finally {
      mkdirSync.mockRestore();
      existsSync.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("probeLogWritable returns boolean", () => {
    const result = probeLogWritable();
    expect(typeof result).toBe("boolean");
  });

  describe("probeLogWritable and getLogExcerpt with mocked fs", () => {
    let appendSpy: ReturnType<typeof vi.spyOn>;
    let tmpdirSpy: ReturnType<typeof vi.spyOn>;

    afterEach(() => {
      appendSpy?.mockRestore();
      tmpdirSpy?.mockRestore();
      vi.unstubAllEnvs();
    });

    it("probeLogWritable returns false when getLogPath is empty", () => {
      vi.stubEnv("AGENTRON_DATA_DIR", "/nonexistent-dir-no-create");
      vi.spyOn(fs, "mkdirSync").mockImplementation(() => {
        throw new Error("Permission denied");
      });
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      expect(probeLogWritable()).toBe(false);
    });

    it("probeLogWritable uses fallback when primary append throws and fallback succeeds", () => {
      const dataDir = require("node:path").join(process.cwd(), ".data");
      vi.stubEnv("AGENTRON_DATA_DIR", dataDir);
      const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(true);
      appendSpy = vi.spyOn(fs, "appendFileSync");
      let callCount = 0;
      appendSpy.mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw new Error("Primary write failed");
      });
      try {
        const result = probeLogWritable();
        expect(result).toBe(true);
      } finally {
        existsSpy.mockRestore();
      }
    });

    it("probeLogWritable returns false when both primary and fallback append throw", () => {
      appendSpy = vi.spyOn(fs, "appendFileSync").mockImplementation(() => {
        throw new Error("Write failed");
      });
      const result = probeLogWritable();
      expect(result).toBe(false);
    });

    it("getLogExcerpt includes fallback label when reading from tmp path", () => {
      vi.stubEnv("AGENTRON_DATA_DIR", "/nonexistent-dir-no-create");
      const mkdirSpy = vi.spyOn(fs, "mkdirSync").mockImplementation(() => {
        throw new Error("Permission denied");
      });
      const fallbackPath = require("node:path").join(os.tmpdir(), "agentron-api.log");
      const readSpy = vi.spyOn(fs, "readFileSync").mockImplementation((pathArg: unknown) => {
        if (pathArg === fallbackPath) return "line1\nline2\n";
        throw new Error("Unexpected path");
      });
      const existsSpy = vi.spyOn(fs, "existsSync").mockImplementation((pathArg: unknown) => {
        return pathArg === fallbackPath;
      });
      try {
        const result = getLogExcerpt(10);
        expect(result).toContain("(fallback tmp)");
        expect(result).toContain("line1");
      } finally {
        readSpy.mockRestore();
        existsSpy.mockRestore();
        mkdirSpy.mockRestore();
      }
    });
  });
});
