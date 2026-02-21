import { json } from "../_lib/response";
import { db, feedback, toFeedbackRow, fromFeedbackRow } from "../_lib/db";
import { eq } from "drizzle-orm";
import { embedFeedbackOnCreate } from "../_lib/feedback-retrieval";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const targetId = url.searchParams.get("targetId");
  const targetType = url.searchParams.get("targetType");
  const executionId = url.searchParams.get("executionId");

  let rows;
  if (executionId != null && executionId !== "") {
    rows = await db.select().from(feedback).where(eq(feedback.executionId, executionId));
  } else if (targetId) {
    rows = await db.select().from(feedback).where(eq(feedback.targetId, targetId));
  } else if (targetType) {
    rows = await db.select().from(feedback).where(eq(feedback.targetType, targetType));
  } else {
    rows = await db.select().from(feedback);
  }
  return json(rows.map(fromFeedbackRow));
}

export async function POST(request: Request) {
  const payload = await request.json();
  const id = payload.id ?? crypto.randomUUID();
  const entry = {
    ...payload,
    id,
    createdAt: Date.now(),
  };
  await db.insert(feedback).values(toFeedbackRow(entry)).run();
  embedFeedbackOnCreate({
    id: entry.id,
    targetType: entry.targetType,
    targetId: entry.targetId,
    input: entry.input,
    output: entry.output,
    label: entry.label,
    notes: entry.notes,
  }).catch(() => {});
  return json(entry, { status: 201 });
}
