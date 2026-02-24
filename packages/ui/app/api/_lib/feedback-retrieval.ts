/**
 * Feedback embedding and retrieval by similarity.
 * When an encoding config is available, feedback is embedded and stored in feedback_vectors;
 * at query time we retrieve the most relevant feedback for the user message.
 * When no embedding model is configured or embed fails, we fall back to "last N by time".
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { feedback, feedbackVectors, ragCollections } from "@agentron-studio/core";
import { getDeploymentCollectionId } from "./rag";
import { getEncodingConfig } from "./embeddings";
import { embed } from "./embeddings";
import { fromFeedbackRow } from "./db";

const MAX_TEXT_FOR_EMBED = 2000;

export type FeedbackRowForEmbed = {
  id: string;
  targetType: string;
  targetId: string;
  input: unknown;
  output: unknown;
  label: string;
  notes?: string | null;
};

/**
 * Build a single string from a feedback item for embedding (input + output summary).
 */
export function feedbackToEmbeddingText(fb: FeedbackRowForEmbed): string {
  const inputStr =
    typeof fb.input === "string" ? fb.input : JSON.stringify(fb.input ?? "").slice(0, 800);
  const outputStr =
    typeof fb.output === "string" ? fb.output : JSON.stringify(fb.output ?? "").slice(0, 800);
  const labelNote = [fb.label, fb.notes].filter(Boolean).join(" ");
  const combined = [inputStr, outputStr, labelNote].filter(Boolean).join(" -> ");
  if (combined.length <= MAX_TEXT_FOR_EMBED) return combined;
  return combined.slice(0, MAX_TEXT_FOR_EMBED - 1) + "…";
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Try to embed a new feedback item and store in feedback_vectors.
 * Uses deployment collection's encoding config. No-op (no error) if no encoding or embed fails.
 */
export async function embedFeedbackOnCreate(fb: FeedbackRowForEmbed): Promise<void> {
  const collectionId = await getDeploymentCollectionId();
  if (!collectionId) return;
  const collections = await db
    .select({ encodingConfigId: ragCollections.encodingConfigId })
    .from(ragCollections)
    .where(eq(ragCollections.id, collectionId))
    .limit(1);
  if (collections.length === 0) return;
  const encodingConfigId = collections[0].encodingConfigId;
  const text = feedbackToEmbeddingText(fb);
  try {
    const [vector] = await embed(encodingConfigId, [text]);
    if (!vector || vector.length === 0) return;
    await db
      .insert(feedbackVectors)
      .values({
        id: crypto.randomUUID(),
        feedbackId: fb.id,
        targetType: fb.targetType,
        targetId: fb.targetId,
        embedding: JSON.stringify(vector),
        textForEmbed: text,
        createdAt: Date.now(),
      })
      .run();
  } catch {
    // Optional: do not fail feedback create when embed fails
  }
}

/**
 * Retrieve feedback items most relevant to the query by similarity.
 * Returns full feedback rows (for buildFeedbackInjection) or null if no encoding / no vectors (caller uses last N).
 */
export async function getRelevantFeedbackForScope(
  targetType: string,
  targetId: string,
  query: string,
  limit: number,
  minScore?: number
): Promise<ReturnType<typeof fromFeedbackRow>[] | null> {
  const collectionId = await getDeploymentCollectionId();
  if (!collectionId) return null;
  const collRows = await db
    .select({ encodingConfigId: ragCollections.encodingConfigId })
    .from(ragCollections)
    .where(eq(ragCollections.id, collectionId))
    .limit(1);
  if (collRows.length === 0) return null;
  const encodingConfigId = collRows[0].encodingConfigId;
  const rows = await db
    .select()
    .from(feedbackVectors)
    .where(and(eq(feedbackVectors.targetType, targetType), eq(feedbackVectors.targetId, targetId)));
  if (rows.length === 0) return null;
  let queryVector: number[];
  try {
    const [v] = await embed(encodingConfigId, [query]);
    if (!v) return null;
    queryVector = v;
  } catch {
    return null;
  }
  const withScore: { feedbackId: string; score: number }[] = [];
  for (const r of rows) {
    let vec: number[];
    try {
      vec = JSON.parse(r.embedding) as number[];
    } catch {
      continue;
    }
    const score = cosineSimilarity(queryVector, vec);
    if (minScore != null && score < minScore) continue;
    withScore.push({ feedbackId: r.feedbackId, score });
  }
  withScore.sort((a, b) => b.score - a.score);
  const top = withScore.slice(0, limit).map((x) => x.feedbackId);
  if (top.length === 0) return [];
  const ordered = await db.select().from(feedback).where(inArray(feedback.id, top));
  const byId = new Map(top.map((id, i) => [id, i]));
  ordered.sort((a, b) => (byId.get(a.id) ?? 0) - (byId.get(b.id) ?? 0));
  return ordered.map(fromFeedbackRow);
}
