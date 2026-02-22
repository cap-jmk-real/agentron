import { describe, it, expect } from "vitest";
import {
  getEffectiveRagRetrieveLimit,
  getEffectiveFeedbackLimits,
  RAG_RETRIEVE_LIMIT_DEFAULT,
  RAG_RETRIEVE_LIMIT_MAX,
  FEEDBACK_LAST_N_DEFAULT,
  FEEDBACK_RETRIEVE_CAP_DEFAULT,
} from "../../../app/api/_lib/rag-limits";
import { db } from "../../../app/api/_lib/db";
import { ragCollections, chatAssistantSettings, agents } from "@agentron-studio/core";
import { eq } from "drizzle-orm";

describe("rag-limits", () => {
  describe("getEffectiveRagRetrieveLimit", () => {
    it("returns a number for chat scope", async () => {
      const limit = await getEffectiveRagRetrieveLimit({ type: "chat" });
      expect(typeof limit).toBe("number");
      expect(limit).toBeGreaterThanOrEqual(1);
      expect(limit).toBeLessThanOrEqual(RAG_RETRIEVE_LIMIT_MAX);
    });

    it("returns default for non-existent collection", async () => {
      const limit = await getEffectiveRagRetrieveLimit({
        type: "collection",
        collectionId: "non-existent-collection-id",
      });
      expect(limit).toBe(RAG_RETRIEVE_LIMIT_DEFAULT);
    });

    it("returns collection ragRetrieveLimit when set", async () => {
      const collId = "rag-limits-coll-" + Date.now();
      await db
        .insert(ragCollections)
        .values({
          id: collId,
          name: "RAG limits test",
          scope: "agent",
          encodingConfigId: "enc-dummy",
          documentStoreId: "store-dummy",
          ragRetrieveLimit: 25,
          createdAt: Date.now(),
        })
        .run();
      try {
        const limit = await getEffectiveRagRetrieveLimit({
          type: "collection",
          collectionId: collId,
        });
        expect(limit).toBe(25);
      } finally {
        await db.delete(ragCollections).where(eq(ragCollections.id, collId)).run();
      }
    });

    it("returns default for collection with null ragRetrieveLimit", async () => {
      const collId = "rag-limits-coll-null-" + Date.now();
      await db
        .insert(ragCollections)
        .values({
          id: collId,
          name: "RAG limits null",
          scope: "agent",
          encodingConfigId: "enc-dummy",
          documentStoreId: "store-dummy",
          ragRetrieveLimit: null,
          createdAt: Date.now(),
        })
        .run();
      try {
        const limit = await getEffectiveRagRetrieveLimit({
          type: "collection",
          collectionId: collId,
        });
        expect(limit).toBe(RAG_RETRIEVE_LIMIT_DEFAULT);
      } finally {
        await db.delete(ragCollections).where(eq(ragCollections.id, collId)).run();
      }
    });

    it("returns agent collection ragRetrieveLimit when agent has ragCollectionId", async () => {
      const collId = "rag-limits-agent-coll-" + Date.now();
      const agentId = "rag-limits-agent-with-coll-" + Date.now();
      await db
        .insert(ragCollections)
        .values({
          id: collId,
          name: "Agent RAG coll",
          scope: "agent",
          encodingConfigId: "enc-dummy",
          documentStoreId: "store-dummy",
          ragRetrieveLimit: 30,
          createdAt: Date.now(),
        })
        .run();
      await db
        .insert(agents)
        .values({
          id: agentId,
          name: "Agent with RAG coll",
          kind: "node",
          type: "internal",
          protocol: "native",
          capabilities: "[]",
          scopes: "[]",
          ragCollectionId: collId,
          createdAt: Date.now(),
        })
        .run();
      try {
        const limit = await getEffectiveRagRetrieveLimit({
          type: "agent",
          agentId,
        });
        expect(limit).toBe(30);
      } finally {
        await db.delete(agents).where(eq(agents.id, agentId)).run();
        await db.delete(ragCollections).where(eq(ragCollections.id, collId)).run();
      }
    });

    it("returns chat settings ragRetrieveLimit when set", async () => {
      const now = Date.now();
      const existing = await db
        .select()
        .from(chatAssistantSettings)
        .where(eq(chatAssistantSettings.id, "default"))
        .limit(1);
      if (existing.length === 0) {
        await db.insert(chatAssistantSettings).values({ id: "default", updatedAt: now }).run();
      }
      await db
        .update(chatAssistantSettings)
        .set({ ragRetrieveLimit: 18, updatedAt: now })
        .where(eq(chatAssistantSettings.id, "default"))
        .run();
      try {
        const limit = await getEffectiveRagRetrieveLimit({ type: "chat" });
        expect(limit).toBe(18);
      } finally {
        await db
          .update(chatAssistantSettings)
          .set({ ragRetrieveLimit: null, updatedAt: Date.now() })
          .where(eq(chatAssistantSettings.id, "default"))
          .run();
      }
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

    it("returns chat overrides when feedbackLastN and feedbackRetrieveCap and feedbackMinScore set", async () => {
      const now = Date.now();
      const before = await db
        .select()
        .from(chatAssistantSettings)
        .where(eq(chatAssistantSettings.id, "default"))
        .limit(1);
      if (before.length === 0) {
        await db
          .insert(chatAssistantSettings)
          .values({
            id: "default",
            feedbackLastN: 20,
            feedbackRetrieveCap: 25,
            feedbackMinScore: "0.5",
            updatedAt: now,
          })
          .run();
      } else {
        await db
          .update(chatAssistantSettings)
          .set({
            feedbackLastN: 20,
            feedbackRetrieveCap: 25,
            feedbackMinScore: "0.5",
            updatedAt: now,
          })
          .where(eq(chatAssistantSettings.id, "default"))
          .run();
      }
      try {
        const limits = await getEffectiveFeedbackLimits({ type: "chat" });
        expect(limits.lastN).toBe(20);
        expect(limits.retrieveCap).toBe(25);
        expect(limits.minScore).toBe(0.5);
      } finally {
        await db
          .update(chatAssistantSettings)
          .set({
            feedbackLastN: null,
            feedbackRetrieveCap: null,
            feedbackMinScore: null,
            updatedAt: Date.now(),
          })
          .where(eq(chatAssistantSettings.id, "default"))
          .run();
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

    it("returns agent feedbackLastN and feedbackRetrieveCap when set", async () => {
      const agentId = "rag-limits-agent-" + Date.now();
      await db
        .insert(agents)
        .values({
          id: agentId,
          name: "RAG limits agent",
          kind: "node",
          type: "internal",
          protocol: "native",
          capabilities: "[]",
          scopes: "[]",
          feedbackLastN: 12,
          feedbackRetrieveCap: 15,
          createdAt: Date.now(),
        })
        .run();
      try {
        const limits = await getEffectiveFeedbackLimits({ type: "agent", agentId });
        expect(limits.lastN).toBe(12);
        expect(limits.retrieveCap).toBe(15);
      } finally {
        await db.delete(agents).where(eq(agents.id, agentId)).run();
      }
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
