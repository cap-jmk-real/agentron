import { and, desc, eq } from "drizzle-orm";
import { db, feedback, fromFeedbackRow } from "./db";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const SUMMARY_MAX_CHARS = 160;

type FeedbackRow = ReturnType<typeof fromFeedbackRow>;

export type FeedbackForScopeOptions = {
  label?: FeedbackRow["label"];
  limit?: number;
};

export type FeedbackForScopeItem = {
  id: string;
  targetType: FeedbackRow["targetType"];
  targetId: string;
  executionId?: string;
  label?: FeedbackRow["label"];
  notes?: string;
  createdAt: number;
  inputSummary?: string;
  outputSummary?: string;
};

function summarize(value: unknown): string | undefined {
  if (value == null) return undefined;
  let text: string;
  if (typeof value === "string") {
    text = value.trim();
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  if (!text) return undefined;
  if (text.length <= SUMMARY_MAX_CHARS) return text;
  return text.slice(0, SUMMARY_MAX_CHARS - 1) + "…";
}

export async function getFeedbackForScope(
  targetId: string,
  options: FeedbackForScopeOptions = {}
): Promise<FeedbackForScopeItem[]> {
  const limit =
    typeof options.limit === "number" && options.limit > 0
      ? Math.min(options.limit, MAX_LIMIT)
      : DEFAULT_LIMIT;

  const where =
    options.label != null
      ? and(eq(feedback.targetId, targetId), eq(feedback.label, options.label))
      : eq(feedback.targetId, targetId);

  const rows = await db
    .select()
    .from(feedback)
    .where(where)
    .orderBy(desc(feedback.createdAt))
    .limit(limit);

  const items = rows.map(fromFeedbackRow);

  return items.map((f) => ({
    id: f.id,
    targetType: f.targetType,
    targetId: f.targetId,
    executionId: f.executionId,
    label: f.label,
    notes: f.notes,
    createdAt: f.createdAt,
    inputSummary: summarize(f.input),
    outputSummary: summarize(f.output),
  }));
}

