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

  it("getLogExcerpt ignores path when readFileSync throws", () => {
    const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const readSpy = vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("read failed");
    });
    try {
      const result = getLogExcerpt(5);
      expect(typeof result).toBe("string");
      expect(result).toBe("");
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

  it("appendLogLine handles getFallbackLogPath when os.tmpdir throws", () => {
    const appendSpy = vi.spyOn(fs, "appendFileSync").mockImplementation(() => {
      throw new Error("primary failed");
    });
    const tmpdirSpy = vi.spyOn(os, "tmpdir").mockImplementation(() => {
      throw new Error("tmpdir failed");
    });
    try {
      appendLogLine("/api/test", "GET", "tmpdir-fail message");
    } finally {
      appendSpy.mockRestore();
      tmpdirSpy.mockRestore();
    }
  });

  it("appendLogLine does not throw when both primary and fallback appendFileSync throw", () => {
    const appendSpy = vi.spyOn(fs, "appendFileSync").mockImplementation(() => {
      throw new Error("write failed");
    });
    try {
      appendLogLine("/api/test", "GET", "no-write message");
    } finally {
      appendSpy.mockRestore();
    }
  });

  it("appendLogLine uses fallback when primary appendFileSync throws and fallback succeeds", () => {
    const appendSpy = vi.spyOn(fs, "appendFileSync");
    let callCount = 0;
    const tmpPath = require("node:path").join(os.tmpdir(), "agentron-api.log");
    appendSpy.mockImplementation((pathArg: unknown) => {
      callCount++;
      if (pathArg === tmpPath) return;
      throw new Error("Primary write failed");
    });
    const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(true);
    try {
      appendLogLine("/api/test", "GET", "fallback message");
      expect(callCount).toBe(2);
    } finally {
      appendSpy.mockRestore();
      existsSpy.mockRestore();
    }
  });

  it("getLogDir returns string", () => {
    const dir = getLogDir();
    expect(typeof dir).toBe("string");
  });

  it("getLogDir uses AGENTRON_DATA_DIR when set", () => {
    const customDir = require("node:path").join(os.tmpdir(), "agentron-custom-data");
    vi.stubEnv("AGENTRON_DATA_DIR", customDir);
    const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(true);
    try {
      const dir = getLogDir();
      expect(dir).toBe(customDir);
    } finally {
      existsSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("getLogDir uses path.join(process.cwd(), .data) when AGENTRON_DATA_DIR is unset", () => {
    const saved = process.env.AGENTRON_DATA_DIR;
    delete process.env.AGENTRON_DATA_DIR;
    try {
      const dir = getLogDir();
      expect(dir).toContain(".data");
    } finally {
      if (saved !== undefined) process.env.AGENTRON_DATA_DIR = saved;
    }
  });

  it("getLogDir returns empty string when mkdirSync throws", () => {
    const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(false);
    const mkdirSpy = vi.spyOn(fs, "mkdirSync").mockImplementation(() => {
      throw new Error("mkdir failed");
    });
    try {
      const dir = getLogDir();
      expect(dir).toBe("");
    } finally {
      existsSpy.mockRestore();
      mkdirSpy.mockRestore();
    }
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
    let tmpdirSpy: ReturnType<typeof vi.spyOn> | undefined;

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

    it("probeLogWritable returns false when primary append throws and fallback path is empty", () => {
      const dataDir = require("node:path").join(process.cwd(), ".data-probe");
      vi.stubEnv("AGENTRON_DATA_DIR", dataDir);
      const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(true);
      appendSpy = vi.spyOn(fs, "appendFileSync").mockImplementation(() => {
        throw new Error("Primary failed");
      });
      const tmpdirSpy = vi.spyOn(os, "tmpdir").mockImplementation(() => {
        throw new Error("tmpdir failed");
      });
      try {
        const result = probeLogWritable();
        expect(result).toBe(false);
      } finally {
        existsSpy.mockRestore();
        appendSpy.mockRestore();
        tmpdirSpy.mockRestore();
        vi.unstubAllEnvs();
      }
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

    it("getLogExcerpt from primary path has no fallback label (label empty branch)", () => {
      const pathModule = require("node:path");
      const dataDir = pathModule.join(process.cwd(), ".data-primary-excerpt");
      vi.stubEnv("AGENTRON_DATA_DIR", dataDir);
      const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(true);
      const primaryPath = getLogPath();
      if (!primaryPath || primaryPath.startsWith(os.tmpdir())) {
        existsSpy.mockRestore();
        vi.unstubAllEnvs();
        return;
      }
      const readSpy = vi.spyOn(fs, "readFileSync").mockImplementation((pathArg: unknown) => {
        if (pathArg === primaryPath) return "primary-line1\nprimary-line2\n";
        throw new Error("Unexpected path");
      });
      existsSpy.mockImplementation((pathArg: unknown) => pathArg === primaryPath);
      try {
        const result = getLogExcerpt(10);
        expect(result).not.toContain("(fallback tmp)");
        expect(result).toContain("primary-line1");
      } finally {
        readSpy.mockRestore();
        existsSpy.mockRestore();
        vi.unstubAllEnvs();
      }
    });
  });
});
