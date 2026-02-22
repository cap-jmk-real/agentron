import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { getDataDir } from "../../../app/api/_lib/db";
import {
  loadSpecialistOverrides,
  saveSpecialistOverrides,
} from "../../../app/api/_lib/specialist-overrides";
import type { SpecialistEntry } from "@agentron-studio/runtime";

function getOverridePath(): string {
  return path.join(getDataDir(), "specialist_overrides.json");
}

describe("specialist-overrides", () => {
  afterEach(() => {
    const p = getOverridePath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });

  it("loadSpecialistOverrides returns empty array when file missing", () => {
    expect(loadSpecialistOverrides()).toEqual([]);
  });

  it("loadSpecialistOverrides returns empty array when file has invalid JSON", () => {
    fs.writeFileSync(getOverridePath(), "not json {", "utf8");
    expect(loadSpecialistOverrides()).toEqual([]);
  });

  it("loadSpecialistOverrides returns empty array when file content is not array", () => {
    fs.writeFileSync(getOverridePath(), "{}", "utf8");
    expect(loadSpecialistOverrides()).toEqual([]);
  });

  it("loadSpecialistOverrides filters to valid SpecialistEntry only", () => {
    const valid: SpecialistEntry = { id: "spec-1", toolNames: ["tool_a"] };
    fs.writeFileSync(
      getOverridePath(),
      JSON.stringify([
        valid,
        null,
        { id: "no-toolNames" },
        { toolNames: [] },
        { id: "x", toolNames: "not-array" },
        { id: "y", toolNames: [] },
      ]),
      "utf8"
    );
    const result = loadSpecialistOverrides();
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(valid);
    expect(result[1]).toEqual({ id: "y", toolNames: [] });
  });

  it("saveSpecialistOverrides and loadSpecialistOverrides roundtrip", () => {
    const entries: SpecialistEntry[] = [
      { id: "a", toolNames: ["t1", "t2"] },
      { id: "b", toolNames: [] },
    ];
    saveSpecialistOverrides(entries);
    expect(loadSpecialistOverrides()).toEqual(entries);
  });
});
