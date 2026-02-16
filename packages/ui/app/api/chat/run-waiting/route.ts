import { json } from "../../_lib/response";
import { db, executions } from "../../_lib/db";
import { eq, and, desc } from "drizzle-orm";

function extractRunWaitingQuestion(raw: unknown): { runId: string; question?: string; options?: string[] } | null {
  if (!raw || typeof raw !== "object" || !("id" in raw)) return null;
  const id = (raw as { id?: unknown }).id;
  if (typeof id !== "string" || !id) return null;
  const current = raw as Record<string, unknown>;
  const inner = current?.output && typeof current.output === "object" && current.output !== null
    ? (current.output as Record<string, unknown>)
    : current;
  let question: string | undefined;
  if (inner && typeof inner.question === "string" && inner.question.trim()) {
    question = inner.question.trim();
  } else if (inner && typeof inner.message === "string" && inner.message.trim()) {
    question = inner.message.trim();
  }
  // Do not use trail argsSummary for question — it is truncated; payload (inner) has the full text.
  const opts = Array.isArray(inner?.suggestions) ? inner.suggestions : Array.isArray(inner?.options) ? inner.options : undefined;
  const options = opts?.map((o) => String(o)).filter(Boolean) ?? [];
  return { runId: id, question, options };
}

/** Returns whether the given conversation has a workflow run waiting for user input, plus the run's question and options when applicable. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const conversationId = searchParams.get("conversationId")?.trim() || undefined;
  if (!conversationId) {
    return json({ runWaiting: false });
  }
  const rows = await db
    .select({ id: executions.id, output: executions.output })
    .from(executions)
    .where(and(eq(executions.status, "waiting_for_user"), eq(executions.conversationId, conversationId)))
    .orderBy(desc(executions.startedAt))
    .limit(1);
  if (rows.length === 0) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'run-waiting/route.ts:GET',message:'run-waiting no run found',data:{conversationId},hypothesisId:'H3',timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return json({ runWaiting: false });
  }
  const raw = rows[0].output;
  let parsed: unknown;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    parsed = null;
  }
  const spread = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const payload = extractRunWaitingQuestion({ id: rows[0].id, ...spread });
  // Prefer full question from flat payload (written by request_user_help); avoid any truncated fallback
  const question =
    typeof spread.question === "string" && spread.question.trim()
      ? spread.question.trim()
      : typeof spread.message === "string" && spread.message.trim()
        ? spread.message.trim()
        : payload?.question;
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'run-waiting/route.ts:GET',message:'run-waiting returning',data:{runId:rows[0].id,rawType:typeof raw,rawLen:typeof raw==='string'?raw.length:0,spreadKeys:Object.keys(spread),questionLen:question?.length??0,optionsLen:payload?.options?.length??0},hypothesisId:'H1',timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  return json({
    runWaiting: true,
    runId: payload?.runId ?? rows[0].id,
    question,
    options: payload?.options ?? [],
  });
}
