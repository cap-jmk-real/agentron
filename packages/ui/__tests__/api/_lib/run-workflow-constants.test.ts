import { describe, it, expect } from "vitest";
import {
  isToolResultFailure,
  WaitingForUserError,
  WAITING_FOR_USER_MESSAGE,
  RUN_CANCELLED_MESSAGE,
} from "../../../app/api/_lib/run-workflow-constants";

describe("run-workflow-constants", () => {
  describe("isToolResultFailure", () => {
    it("returns false for null or non-object", () => {
      expect(isToolResultFailure(null)).toBe(false);
      expect(isToolResultFailure(undefined)).toBe(false);
      expect(isToolResultFailure("error")).toBe(false);
      expect(isToolResultFailure(42)).toBe(false);
    });

    it("returns true when error is non-empty string", () => {
      expect(isToolResultFailure({ error: "Something failed" })).toBe(true);
      expect(isToolResultFailure({ error: "  x  " })).toBe(true);
      expect(isToolResultFailure({ error: "" })).toBe(false);
      expect(isToolResultFailure({ error: "   " })).toBe(false);
    });

    it("returns true when exitCode is non-zero number", () => {
      expect(isToolResultFailure({ exitCode: 1 })).toBe(true);
      expect(isToolResultFailure({ exitCode: -1 })).toBe(true);
      expect(isToolResultFailure({ exitCode: 0 })).toBe(false);
      expect(isToolResultFailure({ exitCode: "1" })).toBe(false);
    });

    it("returns true when statusCode or status is 4xx or 5xx", () => {
      expect(isToolResultFailure({ statusCode: 404 })).toBe(true);
      expect(isToolResultFailure({ statusCode: 500 })).toBe(true);
      expect(isToolResultFailure({ status: 403 })).toBe(true);
      expect(isToolResultFailure({ statusCode: 200 })).toBe(false);
      expect(isToolResultFailure({ statusCode: 399 })).toBe(false);
      expect(isToolResultFailure({ statusCode: 600 })).toBe(false);
    });

    it("returns false when no failure indicators", () => {
      expect(isToolResultFailure({})).toBe(false);
      expect(isToolResultFailure({ output: "ok" })).toBe(false);
    });
  });

  describe("WaitingForUserError", () => {
    it("sets name and message and preserves trail", () => {
      const trail = [{ nodeId: "n1", agentId: "a1", agentName: "A", order: 1 }];
      const err = new WaitingForUserError(WAITING_FOR_USER_MESSAGE, trail);
      expect(err.name).toBe("WaitingForUserError");
      expect(err.message).toBe(WAITING_FOR_USER_MESSAGE);
      expect(err.trail).toEqual(trail);
    });
  });

  describe("constants", () => {
    it("exports expected message constants", () => {
      expect(WAITING_FOR_USER_MESSAGE).toBe("WAITING_FOR_USER");
      expect(RUN_CANCELLED_MESSAGE).toBe("Run cancelled by user");
    });
  });
});
