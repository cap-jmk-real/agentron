import { describe, it, expect } from "vitest";
import { SYSTEM_PROMPT } from "@agentron-studio/runtime";
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

  describe("connector auth prompt block", () => {
    it("SYSTEM_PROMPT includes connector auth and empty-connectors guidance", () => {
      expect(SYSTEM_PROMPT).toContain("Knowledge → Connectors");
      expect(SYSTEM_PROMPT).toContain("list_connector_items");
      expect(SYSTEM_PROMPT).toContain("empty list");
      expect(SYSTEM_PROMPT).toContain("add one in Knowledge → Connectors first");
      expect(SYSTEM_PROMPT).toContain("authentication");
      expect(SYSTEM_PROMPT).toContain("credentials");
    });
  });
});
