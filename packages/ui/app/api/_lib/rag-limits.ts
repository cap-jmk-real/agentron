/**
 * Effective RAG retrieve limit and feedback limits (tunable by system default/max and user/agent overrides).
 */

import { eq } from "drizzle-orm";
import { db } from "./db";
import { chatAssistantSettings, ragCollections, agents } from "@agentron-studio/core";
import { fromChatAssistantSettingsRow } from "./db-mappers";

const RAG_RETRIEVE_LIMIT_DEFAULT = Math.min(
  Math.max(1, parseInt(process.env.RAG_RETRIEVE_LIMIT_DEFAULT ?? "10", 10) || 10),
  100
);
const RAG_RETRIEVE_LIMIT_MAX = Math.min(
  Math.max(10, parseInt(process.env.RAG_RETRIEVE_LIMIT_MAX ?? "50", 10) || 50),
  200
);
const FEEDBACK_LAST_N_DEFAULT = Math.min(
  Math.max(1, parseInt(process.env.FEEDBACK_LAST_N_DEFAULT ?? "10", 10) || 10),
  50
);
const FEEDBACK_RETRIEVE_CAP_DEFAULT = Math.min(
  Math.max(1, parseInt(process.env.FEEDBACK_RETRIEVE_CAP_DEFAULT ?? "10", 10) || 10),
  50
);

export type RagLimitScope =
  | { type: "chat" }
  | { type: "collection"; collectionId: string }
  | { type: "agent"; agentId: string; collectionId?: string | null };

/**
 * Resolve effective RAG retrieve limit (number of chunks) for the given scope.
 * Order: collection override (if scope has collectionId), agent override (if scope is agent), chat settings (if chat), then system default. Clamp to system max.
 */
export async function getEffectiveRagRetrieveLimit(scope: RagLimitScope): Promise<number> {
  let override: number | null = null;
  if (scope.type === "collection" && scope.collectionId) {
    const rows = await db
      .select({ ragRetrieveLimit: ragCollections.ragRetrieveLimit })
      .from(ragCollections)
      .where(eq(ragCollections.id, scope.collectionId))
      .limit(1);
    if (rows.length > 0 && rows[0].ragRetrieveLimit != null) {
      override = Math.max(1, Math.min(RAG_RETRIEVE_LIMIT_MAX, rows[0].ragRetrieveLimit));
    }
  }
  if (override == null && scope.type === "agent" && scope.agentId) {
    const agentRows = await db.select().from(agents).where(eq(agents.id, scope.agentId)).limit(1);
    if (agentRows.length > 0 && agentRows[0].ragCollectionId) {
      const collRows = await db
        .select({ ragRetrieveLimit: ragCollections.ragRetrieveLimit })
        .from(ragCollections)
        .where(eq(ragCollections.id, agentRows[0].ragCollectionId))
        .limit(1);
      if (collRows.length > 0 && collRows[0].ragRetrieveLimit != null) {
        override = Math.max(1, Math.min(RAG_RETRIEVE_LIMIT_MAX, collRows[0].ragRetrieveLimit));
      }
    }
  }
  if (override == null && scope.type === "chat") {
    const settingsRows = await db
      .select()
      .from(chatAssistantSettings)
      .where(eq(chatAssistantSettings.id, "default"))
      .limit(1);
    if (settingsRows.length > 0) {
      const s = fromChatAssistantSettingsRow(settingsRows[0]);
      if (s.ragRetrieveLimit != null) {
        override = Math.max(1, Math.min(RAG_RETRIEVE_LIMIT_MAX, s.ragRetrieveLimit));
      }
    }
  }
  const value = override ?? RAG_RETRIEVE_LIMIT_DEFAULT;
  return Math.min(value, RAG_RETRIEVE_LIMIT_MAX);
}

export type FeedbackLimitScope = { type: "chat" } | { type: "agent"; agentId: string };

/**
 * Resolve effective feedback limits: last N (fallback) and retrieve cap (top-k when using similarity).
 * Returns { lastN, retrieveCap, minScore }.
 */
export async function getEffectiveFeedbackLimits(scope: FeedbackLimitScope): Promise<{
  lastN: number;
  retrieveCap: number;
  minScore: number | undefined;
}> {
  let lastN = FEEDBACK_LAST_N_DEFAULT;
  let retrieveCap = FEEDBACK_RETRIEVE_CAP_DEFAULT;
  let minScore: number | undefined;
  if (scope.type === "chat") {
    const settingsRows = await db
      .select()
      .from(chatAssistantSettings)
      .where(eq(chatAssistantSettings.id, "default"))
      .limit(1);
    if (settingsRows.length > 0) {
      const s = fromChatAssistantSettingsRow(settingsRows[0]);
      if (s.feedbackLastN != null) lastN = Math.max(1, Math.min(50, s.feedbackLastN));
      if (s.feedbackRetrieveCap != null)
        retrieveCap = Math.max(1, Math.min(50, s.feedbackRetrieveCap));
      if (s.feedbackMinScore != null)
        minScore = Math.max(0, Math.min(1, Number(s.feedbackMinScore)));
    }
  } else {
    const agentRows = await db
      .select({
        feedbackLastN: agents.feedbackLastN,
        feedbackRetrieveCap: agents.feedbackRetrieveCap,
      })
      .from(agents)
      .where(eq(agents.id, scope.agentId))
      .limit(1);
    if (agentRows.length > 0) {
      if (agentRows[0].feedbackLastN != null)
        lastN = Math.max(1, Math.min(50, agentRows[0].feedbackLastN));
      if (agentRows[0].feedbackRetrieveCap != null)
        retrieveCap = Math.max(1, Math.min(50, agentRows[0].feedbackRetrieveCap));
    }
  }
  return { lastN, retrieveCap, minScore };
}

export {
  RAG_RETRIEVE_LIMIT_DEFAULT,
  RAG_RETRIEVE_LIMIT_MAX,
  FEEDBACK_LAST_N_DEFAULT,
  FEEDBACK_RETRIEVE_CAP_DEFAULT,
};
