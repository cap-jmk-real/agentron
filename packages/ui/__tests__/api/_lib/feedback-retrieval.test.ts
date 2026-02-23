import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  feedbackToEmbeddingText,
  getRelevantFeedbackForScope,
  embedFeedbackOnCreate,
} from "../../../app/api/_lib/feedback-retrieval";
import { getDeploymentCollectionId } from "../../../app/api/_lib/rag";
import { db } from "../../../app/api/_lib/db";
import { ragCollections, feedbackVectors, feedback } from "@agentron-studio/core";
import { eq } from "drizzle-orm";

const mockEmbed = vi.fn();
vi.mock("../../../app/api/_lib/rag", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../../app/api/_lib/rag")>();
  return {
    ...mod,
    getDeploymentCollectionId: vi.fn().mockResolvedValue(null),
    retrieveChunks: vi.fn(),
  };
});
vi.mock("../../../app/api/_lib/embeddings", () => ({
  getEncodingConfig: vi.fn(),
  embed: (...args: unknown[]) => mockEmbed(...args),
}));

describe("feedback-retrieval", () => {
  describe("feedbackToEmbeddingText", () => {
    it("combines input, output, label and notes", () => {
      const fb = {
        id: "f1",
        targetType: "chat",
        targetId: "chat",
        input: "user question",
        output: "assistant answer",
        label: "good",
        notes: "helpful",
      };
      expect(feedbackToEmbeddingText(fb)).toContain("user question");
      expect(feedbackToEmbeddingText(fb)).toContain("assistant answer");
      expect(feedbackToEmbeddingText(fb)).toContain("good");
      expect(feedbackToEmbeddingText(fb)).toContain("helpful");
    });

    it("stringifies non-string input and output", () => {
      const fb = {
        id: "f2",
        targetType: "agent",
        targetId: "a1",
        input: { foo: 1 },
        output: [1, 2],
        label: "bad",
        notes: null,
      };
      const text = feedbackToEmbeddingText(fb);
      expect(text).toContain('"foo":1');
      expect(text).toContain("1,2");
      expect(text).toContain("bad");
    });

    it("caps total length at 2000 chars", () => {
      const long = "x".repeat(1000);
      const fb = {
        id: "f3",
        targetType: "chat",
        targetId: "chat",
        input: long,
        output: long,
        label: "good",
        notes: null,
      };
      const text = feedbackToEmbeddingText(fb);
      expect(text.length).toBeLessThanOrEqual(2000);
      expect(text.endsWith("…") || text.length <= 2000).toBe(true);
    });

    it("handles empty or null notes", () => {
      const fb = {
        id: "f4",
        targetType: "chat",
        targetId: "chat",
        input: "q",
        output: "a",
        label: "good",
        notes: undefined,
      };
      expect(feedbackToEmbeddingText(fb)).toBeTruthy();
    });

    it("uses empty string for null input and output", () => {
      const fb = {
        id: "f5",
        targetType: "chat",
        targetId: "chat",
        input: null,
        output: null,
        label: "label",
        notes: null,
      };
      const text = feedbackToEmbeddingText(fb);
      expect(text).toContain("label");
      expect(text).toBeTruthy();
    });

    it("returns combined as-is when length exactly 2000", () => {
      const fb = {
        id: "f6",
        targetType: "chat",
        targetId: "chat",
        input: "a".repeat(1995),
        output: "",
        label: "x",
        notes: null,
      };
      const text = feedbackToEmbeddingText(fb);
      expect(text.length).toBe(2000);
      expect(text.endsWith("…")).toBe(false);
    });
  });

  describe("getRelevantFeedbackForScope", () => {
    beforeEach(() => {
      mockEmbed.mockClear();
    });

    it("returns null when no deployment collection", async () => {
      const result = await getRelevantFeedbackForScope("chat", "chat", "query", 5);
      expect(result).toBeNull();
    });

    it("returns null when collection has no encoding config row", async () => {
      vi.mocked(getDeploymentCollectionId).mockResolvedValueOnce("nonexistent-coll");
      const result = await getRelevantFeedbackForScope("agent", "a1", "query", 5);
      expect(result).toBeNull();
    });

    it("returns null when no feedback vectors for scope", async () => {
      const collId = "coll-relevant-" + Date.now();
      await db
        .insert(ragCollections)
        .values({
          id: collId,
          name: "Test",
          scope: "deployment",
          encodingConfigId: "enc-1",
          documentStoreId: "ds1",
          createdAt: Date.now(),
        })
        .run();
      vi.mocked(getDeploymentCollectionId).mockResolvedValueOnce(collId);
      const result = await getRelevantFeedbackForScope("agent", "no-vectors", "q", 5);
      expect(result).toBeNull();
      await db.delete(ragCollections).where(eq(ragCollections.id, collId)).run();
    });

    it("returns null when embed throws", async () => {
      const scopeId = "scope-embed-throw-" + Date.now();
      const collId = "coll-embed-throw-" + Date.now();
      await db
        .insert(ragCollections)
        .values({
          id: collId,
          name: "Test",
          scope: "deployment",
          encodingConfigId: "enc-1",
          documentStoreId: "ds1",
          createdAt: Date.now(),
        })
        .run();
      vi.mocked(getDeploymentCollectionId).mockResolvedValueOnce(collId);
      const fvId = "fv-throw-" + Date.now();
      const fbId = "fb-throw-" + Date.now();
      await db
        .insert(feedbackVectors)
        .values({
          id: fvId,
          feedbackId: fbId,
          targetType: "agent",
          targetId: scopeId,
          embedding: "[0.1,0.2]",
          textForEmbed: "text",
          createdAt: Date.now(),
        })
        .run();
      mockEmbed.mockImplementationOnce(() => Promise.reject(new Error("embed failed")));
      const result = await getRelevantFeedbackForScope("agent", scopeId, "query", 5);
      expect(result).toBeNull();
      await db.delete(feedbackVectors).where(eq(feedbackVectors.id, fvId)).run();
      await db.delete(ragCollections).where(eq(ragCollections.id, collId)).run();
    });

    it("returns null when embed returns undefined vector (!v branch)", async () => {
      const scopeId = "scope-no-vec-" + Date.now();
      const collId = "coll-no-vec-" + Date.now();
      await db
        .insert(ragCollections)
        .values({
          id: collId,
          name: "Test",
          scope: "deployment",
          encodingConfigId: "enc-1",
          documentStoreId: "ds1",
          createdAt: Date.now(),
        })
        .run();
      vi.mocked(getDeploymentCollectionId).mockResolvedValueOnce(collId);
      const fvId = "fv-no-vec-" + Date.now();
      const fbId = "fb-no-vec-" + Date.now();
      await db
        .insert(feedbackVectors)
        .values({
          id: fvId,
          feedbackId: fbId,
          targetType: "agent",
          targetId: scopeId,
          embedding: "[0.1,0.2]",
          textForEmbed: "text",
          createdAt: Date.now(),
        })
        .run();
      mockEmbed.mockResolvedValueOnce([undefined]);
      const result = await getRelevantFeedbackForScope("agent", scopeId, "query", 5);
      expect(result).toBeNull();
      await db.delete(feedbackVectors).where(eq(feedbackVectors.id, fvId)).run();
      await db.delete(ragCollections).where(eq(ragCollections.id, collId)).run();
    });

    it("skips row with invalid embedding JSON (parse catch continue)", async () => {
      const scopeId = "scope-bad-json-" + Date.now();
      const collId = "coll-bad-json-" + Date.now();
      await db
        .insert(ragCollections)
        .values({
          id: collId,
          name: "Test",
          scope: "deployment",
          encodingConfigId: "enc-1",
          documentStoreId: "ds1",
          createdAt: Date.now(),
        })
        .run();
      vi.mocked(getDeploymentCollectionId).mockResolvedValueOnce(collId);
      const fbId = "fb-bad-json-" + Date.now();
      await db
        .insert(feedback)
        .values({
          id: fbId,
          targetType: "agent",
          targetId: scopeId,
          input: "q",
          output: "a",
          label: "good",
          notes: null,
          createdAt: Date.now(),
        })
        .run();
      await db
        .insert(feedbackVectors)
        .values({
          id: "fv-valid-" + Date.now(),
          feedbackId: fbId,
          targetType: "agent",
          targetId: scopeId,
          embedding: "[1,0,0]",
          textForEmbed: "t",
          createdAt: Date.now(),
        })
        .run();
      await db
        .insert(feedbackVectors)
        .values({
          id: "fv-invalid-" + Date.now(),
          feedbackId: "other-fb",
          targetType: "agent",
          targetId: scopeId,
          embedding: "not valid json",
          textForEmbed: "t",
          createdAt: Date.now(),
        })
        .run();
      mockEmbed.mockResolvedValueOnce([[1, 0, 0]]);
      const result = await getRelevantFeedbackForScope("agent", scopeId, "query", 5);
      expect(result).toHaveLength(1);
      expect(result![0].id).toBe(fbId);
      await db.delete(feedbackVectors).where(eq(feedbackVectors.targetId, scopeId)).run();
      await db.delete(feedback).where(eq(feedback.id, fbId)).run();
      await db.delete(ragCollections).where(eq(ragCollections.id, collId)).run();
    });

    it("returns ordered feedback by similarity when vectors and feedback rows exist", async () => {
      const scopeId = "scope-sim-" + Date.now();
      const collId = "coll-sim-" + Date.now();
      await db
        .insert(ragCollections)
        .values({
          id: collId,
          name: "Test",
          scope: "deployment",
          encodingConfigId: "enc-1",
          documentStoreId: "ds1",
          createdAt: Date.now(),
        })
        .run();
      const fbId1 = "fb-sim-1-" + Date.now();
      const fbId2 = "fb-sim-2-" + Date.now();
      const now = Date.now();
      await db
        .insert(feedback)
        .values({
          id: fbId1,
          targetType: "agent",
          targetId: scopeId,
          input: "q1",
          output: "a1",
          label: "good",
          notes: null,
          createdAt: now,
        })
        .run();
      await db
        .insert(feedback)
        .values({
          id: fbId2,
          targetType: "agent",
          targetId: scopeId,
          input: "q2",
          output: "a2",
          label: "bad",
          notes: null,
          createdAt: now,
        })
        .run();
      await db
        .insert(feedbackVectors)
        .values({
          id: "fv-sim-1-" + Date.now(),
          feedbackId: fbId1,
          targetType: "agent",
          targetId: scopeId,
          embedding: "[1,0,0]",
          textForEmbed: "q1 a1",
          createdAt: now,
        })
        .run();
      await db
        .insert(feedbackVectors)
        .values({
          id: "fv-sim-2-" + (Date.now() + 1),
          feedbackId: fbId2,
          targetType: "agent",
          targetId: scopeId,
          embedding: "[0,1,0]",
          textForEmbed: "q2 a2",
          createdAt: now,
        })
        .run();
      vi.mocked(getDeploymentCollectionId).mockResolvedValueOnce(collId);
      mockEmbed.mockImplementationOnce(() => Promise.resolve([[1, 0, 0]]));
      const result = await getRelevantFeedbackForScope("agent", scopeId, "query", 5);
      expect(result).not.toBeNull();
      expect(result!.length).toBe(2);
      expect(result![0].id).toBe(fbId1);
      expect(result![0].label).toBe("good");
      expect(result![1].id).toBe(fbId2);
      await db.delete(feedbackVectors).where(eq(feedbackVectors.targetId, scopeId)).run();
      await db.delete(feedback).where(eq(feedback.targetId, scopeId)).run();
      await db.delete(ragCollections).where(eq(ragCollections.id, collId)).run();
    });

    it("filters by minScore when provided", async () => {
      const scopeId = "scope-min-" + Date.now();
      const collId = "coll-min-" + Date.now();
      await db
        .insert(ragCollections)
        .values({
          id: collId,
          name: "Test",
          scope: "deployment",
          encodingConfigId: "enc-1",
          documentStoreId: "ds1",
          createdAt: Date.now(),
        })
        .run();
      const fbId = "fb-min-" + Date.now();
      const fvId = "fv-min-" + Date.now();
      const now = Date.now();
      await db
        .insert(feedback)
        .values({
          id: fbId,
          targetType: "agent",
          targetId: scopeId,
          input: "q",
          output: "a",
          label: "good",
          notes: null,
          createdAt: now,
        })
        .run();
      await db
        .insert(feedbackVectors)
        .values({
          id: fvId,
          feedbackId: fbId,
          targetType: "agent",
          targetId: scopeId,
          embedding: "[0,0,1]",
          textForEmbed: "q a",
          createdAt: now,
        })
        .run();
      vi.mocked(getDeploymentCollectionId).mockResolvedValueOnce(collId);
      mockEmbed.mockImplementationOnce(() => Promise.resolve([[1, 0, 0]]));
      const result = await getRelevantFeedbackForScope("agent", scopeId, "query", 5, 0.99);
      expect(result).toEqual([]);
      await db.delete(feedbackVectors).where(eq(feedbackVectors.id, fvId)).run();
      await db.delete(feedback).where(eq(feedback.id, fbId)).run();
      await db.delete(ragCollections).where(eq(ragCollections.id, collId)).run();
    });

    it("skips vector row when embedding JSON is invalid", async () => {
      const scopeId = "scope-invalid-" + Date.now();
      const collId = "coll-invalid-json-" + Date.now();
      await db
        .insert(ragCollections)
        .values({
          id: collId,
          name: "Test",
          scope: "deployment",
          encodingConfigId: "enc-1",
          documentStoreId: "ds1",
          createdAt: Date.now(),
        })
        .run();
      const fvId = "fv-invalid-" + Date.now();
      await db
        .insert(feedbackVectors)
        .values({
          id: fvId,
          feedbackId: "fb-missing",
          targetType: "agent",
          targetId: scopeId,
          embedding: "not json",
          textForEmbed: "x",
          createdAt: Date.now(),
        })
        .run();
      vi.mocked(getDeploymentCollectionId).mockResolvedValueOnce(collId);
      mockEmbed.mockResolvedValueOnce([[0.1, 0.2]]);
      const result = await getRelevantFeedbackForScope("agent", scopeId, "q", 5);
      expect(result).toEqual([]);
      await db.delete(feedbackVectors).where(eq(feedbackVectors.id, fvId)).run();
      await db.delete(ragCollections).where(eq(ragCollections.id, collId)).run();
    });

    it("treats vector length mismatch as similarity 0 (cosineSimilarity length check)", async () => {
      const scopeId = "scope-len-" + Date.now();
      const collId = "coll-len-" + Date.now();
      await db
        .insert(ragCollections)
        .values({
          id: collId,
          name: "Test",
          scope: "deployment",
          encodingConfigId: "enc-1",
          documentStoreId: "ds1",
          createdAt: Date.now(),
        })
        .run();
      const fbId = "fb-len-" + Date.now();
      await db
        .insert(feedback)
        .values({
          id: fbId,
          targetType: "agent",
          targetId: scopeId,
          input: "q",
          output: "a",
          label: "good",
          notes: null,
          createdAt: Date.now(),
        })
        .run();
      await db
        .insert(feedbackVectors)
        .values({
          id: "fv-len-" + Date.now(),
          feedbackId: fbId,
          targetType: "agent",
          targetId: scopeId,
          embedding: "[1,0]",
          textForEmbed: "t",
          createdAt: Date.now(),
        })
        .run();
      vi.mocked(getDeploymentCollectionId).mockResolvedValueOnce(collId);
      mockEmbed.mockResolvedValueOnce([[1, 0, 0]]);
      const result = await getRelevantFeedbackForScope("agent", scopeId, "query", 5);
      expect(result).toHaveLength(1);
      expect(result![0].id).toBe(fbId);
      await db.delete(feedbackVectors).where(eq(feedbackVectors.targetId, scopeId)).run();
      await db.delete(feedback).where(eq(feedback.id, fbId)).run();
      await db.delete(ragCollections).where(eq(ragCollections.id, collId)).run();
    });

    it("treats zero vectors as similarity 0 (cosineSimilarity denom branch)", async () => {
      const scopeId = "scope-zero-" + Date.now();
      const collId = "coll-zero-" + Date.now();
      await db
        .insert(ragCollections)
        .values({
          id: collId,
          name: "Test",
          scope: "deployment",
          encodingConfigId: "enc-1",
          documentStoreId: "ds1",
          createdAt: Date.now(),
        })
        .run();
      const fbId = "fb-zero-" + Date.now();
      await db
        .insert(feedback)
        .values({
          id: fbId,
          targetType: "agent",
          targetId: scopeId,
          input: "q",
          output: "a",
          label: "good",
          notes: null,
          createdAt: Date.now(),
        })
        .run();
      await db
        .insert(feedbackVectors)
        .values({
          id: "fv-zero-" + Date.now(),
          feedbackId: fbId,
          targetType: "agent",
          targetId: scopeId,
          embedding: "[0,0,0]",
          textForEmbed: "t",
          createdAt: Date.now(),
        })
        .run();
      vi.mocked(getDeploymentCollectionId).mockResolvedValueOnce(collId);
      mockEmbed.mockResolvedValueOnce([[0, 0, 0]]);
      const result = await getRelevantFeedbackForScope("agent", scopeId, "query", 5, 0.01);
      expect(result).toEqual([]);
      await db.delete(feedbackVectors).where(eq(feedbackVectors.targetId, scopeId)).run();
      await db.delete(feedback).where(eq(feedback.id, fbId)).run();
      await db.delete(ragCollections).where(eq(ragCollections.id, collId)).run();
    });
  });

  describe("embedFeedbackOnCreate", () => {
    beforeEach(() => {
      mockEmbed.mockClear();
    });

    it("does not throw when no deployment collection", async () => {
      await expect(
        embedFeedbackOnCreate({
          id: "fb1",
          targetType: "chat",
          targetId: "chat",
          input: "q",
          output: "a",
          label: "good",
          notes: null,
        })
      ).resolves.toBeUndefined();
    });

    it("embeds and inserts feedback_vectors when collection exists and embed returns vector", async () => {
      const collId = "coll-fb-embed-" + Date.now();
      const encId = "enc-1";
      await db
        .insert(ragCollections)
        .values({
          id: collId,
          name: "Test",
          scope: "deployment",
          encodingConfigId: encId,
          documentStoreId: "ds1",
          createdAt: Date.now(),
        })
        .run();
      vi.mocked(getDeploymentCollectionId).mockResolvedValueOnce(collId);
      mockEmbed.mockResolvedValueOnce([[0.1, 0.2, 0.3]]);
      const fbId = "fb-embed-" + Date.now();
      await embedFeedbackOnCreate({
        id: fbId,
        targetType: "agent",
        targetId: "a1",
        input: "query",
        output: "answer",
        label: "good",
        notes: null,
      });
      const rows = await db
        .select()
        .from(feedbackVectors)
        .where(eq(feedbackVectors.feedbackId, fbId));
      expect(rows.length).toBe(1);
      expect(rows[0].targetType).toBe("agent");
      expect(rows[0].targetId).toBe("a1");
      await db.delete(feedbackVectors).where(eq(feedbackVectors.feedbackId, fbId)).run();
      await db.delete(ragCollections).where(eq(ragCollections.id, collId)).run();
    });

    it("does not insert when embed returns empty vector", async () => {
      const collId = "coll-fb-empty-" + Date.now();
      await db
        .insert(ragCollections)
        .values({
          id: collId,
          name: "Test",
          scope: "deployment",
          encodingConfigId: "enc-1",
          documentStoreId: "ds1",
          createdAt: Date.now(),
        })
        .run();
      vi.mocked(getDeploymentCollectionId).mockResolvedValueOnce(collId);
      mockEmbed.mockImplementationOnce(() => Promise.resolve([[]]));
      const fbId = "fb-empty-vec-" + Date.now();
      await embedFeedbackOnCreate({
        id: fbId,
        targetType: "chat",
        targetId: "chat",
        input: "q",
        output: "a",
        label: "good",
        notes: null,
      });
      const rows = await db
        .select()
        .from(feedbackVectors)
        .where(eq(feedbackVectors.feedbackId, fbId));
      expect(rows.length).toBe(0);
      await db.delete(ragCollections).where(eq(ragCollections.id, collId)).run();
    });

    it("does not throw when embed throws", async () => {
      const collId = "coll-fb-err-" + Date.now();
      await db
        .insert(ragCollections)
        .values({
          id: collId,
          name: "Test",
          scope: "deployment",
          encodingConfigId: "enc-1",
          documentStoreId: "ds1",
          createdAt: Date.now(),
        })
        .run();
      vi.mocked(getDeploymentCollectionId).mockResolvedValueOnce(collId);
      mockEmbed.mockRejectedValueOnce(new Error("embed failed"));
      await expect(
        embedFeedbackOnCreate({
          id: "fb-err",
          targetType: "chat",
          targetId: "chat",
          input: "q",
          output: "a",
          label: "good",
          notes: null,
        })
      ).resolves.toBeUndefined();
      await db.delete(ragCollections).where(eq(ragCollections.id, collId)).run();
    });

    it("does not insert when deployment collection id points to non-existent collection", async () => {
      vi.mocked(getDeploymentCollectionId).mockResolvedValueOnce("no-such-collection-id");
      const fbId = "fb-no-coll-" + Date.now();
      await embedFeedbackOnCreate({
        id: fbId,
        targetType: "agent",
        targetId: "a1",
        input: "q",
        output: "a",
        label: "good",
        notes: null,
      });
      const rows = await db
        .select()
        .from(feedbackVectors)
        .where(eq(feedbackVectors.feedbackId, fbId));
      expect(rows.length).toBe(0);
    });
  });
});
