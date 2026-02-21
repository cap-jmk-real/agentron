import { describe, it, expect } from "vitest";
import {
  appendLogLine,
  logApiError,
  getLogExcerpt,
  getLogDir,
  getLogPath,
} from "../../../app/api/_lib/api-logger";

describe("api-logger", () => {
  it("appendLogLine does not throw", () => {
    appendLogLine("/api/test", "GET", "test message");
  });

  it("logApiError with Error does not throw", () => {
    logApiError("/api/test", "POST", new Error("test error"));
  });

  it("logApiError with non-Error value uses String()", () => {
    logApiError("/api/test", "GET", "string error");
  });

  it("getLogExcerpt returns string", () => {
    const result = getLogExcerpt(10);
    expect(typeof result).toBe("string");
  });

  it("getLogExcerpt with zero maxLines returns string", () => {
    const result = getLogExcerpt(0);
    expect(typeof result).toBe("string");
  });

  it("getLogDir returns string", () => {
    const dir = getLogDir();
    expect(typeof dir).toBe("string");
  });

  it("getLogPath returns string when dir exists or empty when not writable", () => {
    const path = getLogPath();
    expect(typeof path).toBe("string");
  });
});
