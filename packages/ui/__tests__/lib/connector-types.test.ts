import { describe, it, expect } from "vitest";
import {
  CONNECTOR_TYPES,
  CONNECTOR_TYPES_SYNC_IMPLEMENTED,
  getConnectorTypeMeta,
  getConnectorTypesWithSync,
  getConnectorTypesForPicker,
} from "../../app/knowledge/_lib/connector-types";

describe("connector-types", () => {
  it("every connector type has non-empty label and logoPath", () => {
    for (const t of CONNECTOR_TYPES) {
      expect(t.label).toBeTruthy();
      expect(t.logoPath).toBeTruthy();
      expect(typeof t.syncImplemented).toBe("boolean");
    }
  });

  it("syncImplemented true only for types in CONNECTOR_TYPES_SYNC_IMPLEMENTED", () => {
    for (const t of CONNECTOR_TYPES) {
      if (t.syncImplemented) {
        expect(CONNECTOR_TYPES_SYNC_IMPLEMENTED.has(t.id)).toBe(true);
      }
    }
  });

  it("every type in CONNECTOR_TYPES_SYNC_IMPLEMENTED has an entry with syncImplemented true", () => {
    for (const id of CONNECTOR_TYPES_SYNC_IMPLEMENTED) {
      const meta = CONNECTOR_TYPES.find((t) => t.id === id);
      expect(meta).toBeDefined();
      expect(meta!.syncImplemented).toBe(true);
    }
  });

  it("getConnectorTypeMeta returns meta for known type", () => {
    expect(getConnectorTypeMeta("google_drive")).toBeDefined();
    expect(getConnectorTypeMeta("google_drive")!.label).toBe("Google Drive");
    expect(getConnectorTypeMeta("unknown_type")).toBeUndefined();
  });

  it("getConnectorTypesWithSync returns only sync-implemented types", () => {
    const withSync = getConnectorTypesWithSync();
    expect(withSync.length).toBe(CONNECTOR_TYPES_SYNC_IMPLEMENTED.size);
    for (const t of withSync) {
      expect(t.syncImplemented).toBe(true);
    }
  });

  it("getConnectorTypesForPicker returns sync-implemented types", () => {
    const picker = getConnectorTypesForPicker();
    expect(picker.length).toBe(CONNECTOR_TYPES_SYNC_IMPLEMENTED.size);
  });
});
