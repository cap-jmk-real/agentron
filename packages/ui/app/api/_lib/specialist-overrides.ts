/**
 * Persisted specialist overlay for the heap. (b) Heap improver can register_specialist / update_specialist;
 * the merged registry is used when running heap mode (getRegistry(loadSpecialistOverrides())).
 */

import * as fs from "fs";
import * as path from "path";
import type { SpecialistEntry } from "@agentron-studio/runtime";
import { getDataDir } from "./db";

const FILENAME = "specialist_overrides.json";

function getPath(): string {
  return path.join(getDataDir(), FILENAME);
}

/** Load overlay specialist entries from .data/specialist_overrides.json. Returns [] if file missing or invalid. */
export function loadSpecialistOverrides(): SpecialistEntry[] {
  try {
    const p = getPath();
    if (!fs.existsSync(p)) return [];
    const raw = fs.readFileSync(p, "utf8");
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data.filter(
      (e): e is SpecialistEntry =>
        e != null &&
        typeof e === "object" &&
        typeof (e as SpecialistEntry).id === "string" &&
        Array.isArray((e as SpecialistEntry).toolNames)
    );
  } catch {
    return [];
  }
}

/** Persist overlay specialist entries. Overwrites the file. */
export function saveSpecialistOverrides(entries: SpecialistEntry[]): void {
  const p = getPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(entries, null, 2), "utf8");
}
