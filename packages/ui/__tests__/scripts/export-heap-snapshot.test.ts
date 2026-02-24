/**
 * One-off: writes the default heap snapshot to apps/docs/public/heap-snapshot.json.
 * Run with: npm run export-heap-snapshot (from packages/ui) or as part of docs build.
 */
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDefaultHeapSnapshot } from "@agentron-studio/runtime";

describe("export heap snapshot for docs", () => {
  it("writes heap-snapshot.json to apps/docs/public", () => {
    const snapshot = getDefaultHeapSnapshot();
    // From packages/ui/__tests__/scripts go up to repo root (4 levels) then apps/docs/public
    const outPath = resolve(__dirname, "../../../../apps/docs/public/heap-snapshot.json");
    writeFileSync(outPath, JSON.stringify(snapshot, null, 2), "utf-8");
    expect(snapshot.topLevelIds.length).toBeGreaterThan(0);
    expect(snapshot.specialists.length).toBeGreaterThan(0);
  });
});
