import { describe, it, expect } from "vitest";
import { studioContextConnectorsFromRows } from "../../app/api/chat/_lib/chat-route-post";

describe("chat-route-post studio context", () => {
  describe("studioContextConnectorsFromRows", () => {
    it("returns empty array when no connector rows", () => {
      expect(studioContextConnectorsFromRows([])).toEqual([]);
    });

    it("maps connector rows to studio context connectors with id and type", () => {
      const rows = [
        { id: "conn-1", type: "filesystem" },
        { id: "conn-2", type: "google_drive" },
      ];
      expect(studioContextConnectorsFromRows(rows)).toEqual([
        { id: "conn-1", type: "filesystem" },
        { id: "conn-2", type: "google_drive" },
      ]);
    });

    it("when ragConnectors has rows, studioContext.connectors is set from them", () => {
      const rows = [{ id: "c1", type: "notion" }];
      const connectors = studioContextConnectorsFromRows(rows);
      expect(connectors).toHaveLength(1);
      expect(connectors[0]).toEqual({ id: "c1", type: "notion" });
    });
  });
});
