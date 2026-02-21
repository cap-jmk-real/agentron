import { describe, it, expect } from "vitest";
import {
  getEffectiveRagRetrieveLimit,
  getEffectiveFeedbackLimits,
  RAG_RETRIEVE_LIMIT_DEFAULT,
  RAG_RETRIEVE_LIMIT_MAX,
  FEEDBACK_LAST_N_DEFAULT,
  FEEDBACK_RETRIEVE_CAP_DEFAULT,
} from "../../../app/api/_lib/rag-limits";

describe("rag-limits", () => {
  describe("getEffectiveRagRetrieveLimit", () => {
    it("returns a number for chat scope", async () => {
      const limit = await getEffectiveRagRetrieveLimit({ type: "chat" });
      expect(typeof limit).toBe("number");
      expect(limit).toBeGreaterThanOrEqual(1);
      expect(limit).toBeLessThanOrEqual(RAG_RETRIEVE_LIMIT_MAX);
    });

    it("returns default or collection override for collection scope", async () => {
      const limit = await getEffectiveRagRetrieveLimit({
        type: "collection",
        collectionId: "non-existent-collection-id",
      });
      expect(limit).toBeGreaterThanOrEqual(1);
      expect(limit).toBeLessThanOrEqual(RAG_RETRIEVE_LIMIT_MAX);
    });
  });

  describe("getEffectiveFeedbackLimits", () => {
    it("returns lastN, retrieveCap, and optional minScore for chat scope", async () => {
      const limits = await getEffectiveFeedbackLimits({ type: "chat" });
      expect(limits.lastN).toBeGreaterThanOrEqual(1);
      expect(limits.lastN).toBeLessThanOrEqual(50);
      expect(limits.retrieveCap).toBeGreaterThanOrEqual(1);
      expect(limits.retrieveCap).toBeLessThanOrEqual(50);
      if (limits.minScore != null) {
        expect(limits.minScore).toBeGreaterThanOrEqual(0);
        expect(limits.minScore).toBeLessThanOrEqual(1);
      }
    });

    it("returns defaults for unknown agent", async () => {
      const limits = await getEffectiveFeedbackLimits({
        type: "agent",
        agentId: "non-existent-agent-id",
      });
      expect(limits.lastN).toBe(FEEDBACK_LAST_N_DEFAULT);
      expect(limits.retrieveCap).toBe(FEEDBACK_RETRIEVE_CAP_DEFAULT);
    });
  });

  describe("constants", () => {
    it("exports system default and max within expected range", () => {
      expect(RAG_RETRIEVE_LIMIT_DEFAULT).toBeGreaterThanOrEqual(1);
      expect(RAG_RETRIEVE_LIMIT_MAX).toBeGreaterThanOrEqual(RAG_RETRIEVE_LIMIT_DEFAULT);
      expect(FEEDBACK_LAST_N_DEFAULT).toBeGreaterThanOrEqual(1);
      expect(FEEDBACK_RETRIEVE_CAP_DEFAULT).toBeGreaterThanOrEqual(1);
    });
  });
});
