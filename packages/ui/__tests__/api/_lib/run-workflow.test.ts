import { describe, it, expect } from "vitest";
import { isToolResultFailure } from "../../../app/api/_lib/run-workflow";

describe("run-workflow isToolResultFailure", () => {
  it("returns false for null or non-object", () => {
    expect(isToolResultFailure(null)).toBe(false);
    expect(isToolResultFailure(undefined)).toBe(false);
    expect(isToolResultFailure("ok")).toBe(false);
    expect(isToolResultFailure(0)).toBe(false);
  });

  it("returns true when error is non-empty string", () => {
    expect(isToolResultFailure({ error: "Something failed" })).toBe(true);
    expect(isToolResultFailure({ error: "x" })).toBe(true);
    expect(isToolResultFailure({ error: "", stdout: "ok" })).toBe(false);
    expect(isToolResultFailure({ error: "   " })).toBe(false);
  });

  it("returns true when exitCode is non-zero", () => {
    expect(isToolResultFailure({ exitCode: 1 })).toBe(true);
    expect(isToolResultFailure({ exitCode: -1 })).toBe(true);
    expect(isToolResultFailure({ exitCode: 0 })).toBe(false);
    expect(isToolResultFailure({ exitCode: 0, stdout: "done" })).toBe(false);
  });

  it("returns true when statusCode or status is 4xx/5xx", () => {
    expect(isToolResultFailure({ statusCode: 400 })).toBe(true);
    expect(isToolResultFailure({ statusCode: 404 })).toBe(true);
    expect(isToolResultFailure({ statusCode: 500 })).toBe(true);
    expect(isToolResultFailure({ status: 502 })).toBe(true);
    expect(isToolResultFailure({ statusCode: 200 })).toBe(false);
    expect(isToolResultFailure({ statusCode: 301 })).toBe(false);
  });
});
