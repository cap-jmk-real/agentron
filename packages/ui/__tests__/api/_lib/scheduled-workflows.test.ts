import { describe, it, expect } from "vitest";
import {
  parseScheduleSeconds,
  parseDaily,
  parseWeekly,
  nextDailyMs,
  nextWeeklyMs,
} from "../../../app/api/_lib/scheduled-workflows";

describe("scheduled-workflows", () => {
  describe("parseScheduleSeconds", () => {
    it("returns seconds for positive integer string", () => {
      expect(parseScheduleSeconds("60")).toBe(60);
      expect(parseScheduleSeconds("  30  ")).toBe(30);
      expect(parseScheduleSeconds("1")).toBe(1);
    });
    it("returns null for invalid or non-positive", () => {
      expect(parseScheduleSeconds("0")).toBeNull();
      expect(parseScheduleSeconds("-1")).toBeNull();
      expect(parseScheduleSeconds("")).toBeNull();
      expect(parseScheduleSeconds("abc")).toBeNull();
      expect(parseScheduleSeconds("daily@12:00")).toBeNull();
    });
  });

  describe("parseDaily", () => {
    it("parses daily@HH:mm", () => {
      expect(parseDaily("daily@9:30")).toEqual({ hour: 9, minute: 30 });
      expect(parseDaily("  daily@0:00  ")).toEqual({ hour: 0, minute: 0 });
      expect(parseDaily("daily@23:59")).toEqual({ hour: 23, minute: 59 });
      expect(parseDaily("daily@12:05")).toEqual({ hour: 12, minute: 5 });
    });
    it("clamps hour and minute", () => {
      expect(parseDaily("daily@99:00")).toEqual({ hour: 23, minute: 0 });
      expect(parseDaily("daily@0:99")).toEqual({ hour: 0, minute: 59 });
    });
    it("returns null for invalid", () => {
      expect(parseDaily("")).toBeNull();
      expect(parseDaily("weekly@1,2")).toBeNull();
      expect(parseDaily("daily@")).toBeNull();
      expect(parseDaily("daily@12")).toBeNull();
      expect(parseDaily("daily@:30")).toBeNull();
    });
  });

  describe("parseWeekly", () => {
    it("parses weekly@d1,d2,...", () => {
      expect(parseWeekly("weekly@0")).toEqual([0]);
      expect(parseWeekly("weekly@1,3,5")).toEqual([1, 3, 5]);
      expect(parseWeekly("  weekly@0,6  ")).toEqual([0, 6]);
    });
    it("clamps day numbers to 0-6", () => {
      expect(parseWeekly("weekly@7")).toEqual([6]);
      expect(parseWeekly("weekly@0,10")).toEqual([0, 6]);
    });
    it("returns null for invalid", () => {
      expect(parseWeekly("")).toBeNull();
      expect(parseWeekly("daily@12:00")).toBeNull();
      expect(parseWeekly("weekly@")).toBeNull();
    });
  });

  describe("nextDailyMs", () => {
    it("returns positive ms until next run today or tomorrow", () => {
      const ms = nextDailyMs(23, 59);
      expect(ms).toBeGreaterThan(0);
      expect(Number.isFinite(ms)).toBe(true);
    });
  });

  describe("nextWeeklyMs", () => {
    it("returns positive ms until next run on one of the days", () => {
      const ms = nextWeeklyMs([0, 1, 2, 3, 4, 5, 6]);
      expect(ms).toBeGreaterThan(0);
      expect(Number.isFinite(ms)).toBe(true);
    });
  });
});
