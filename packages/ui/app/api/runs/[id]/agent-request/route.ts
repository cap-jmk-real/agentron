import { json } from "../../../_lib/response";
import { db, executions } from "../../../_lib/db";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/runs/:id/agent-request
 * Returns the agent's question and options when the run is waiting_for_user.
 * Used by the chat UI so the "What the agent needs" card always shows the full text.
 */
export async function GET(_: Request, { params }: Params) {
  const { id: runId } = await params;
  const rows = await db
    .select({ status: executions.status, output: executions.output })
    .from(executions)
    .where(eq(executions.id, runId))
    .limit(1);
  if (rows.length === 0) {
    return json({ error: "Not found" }, { status: 404 });
  }
  if (rows[0].status !== "waiting_for_user") {
    // #region agent log
    fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location: "agent-request/route.ts:GET",
        message: "run not waiting",
        data: { runId, status: rows[0].status },
        hypothesisId: "H2",
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    return json({ question: undefined, options: [] });
  }
  const raw = rows[0].output;
  let parsed: unknown;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return json({ question: undefined, options: [] });
  }
  if (!parsed || typeof parsed !== "object") {
    return json({ question: undefined, options: [] });
  }
  const out = parsed as Record<string, unknown>;
  // request_user_help writes a flat payload: { question, type, message, suggestions, options }
  const flatQuestion =
    typeof out.question === "string" && out.question.trim() ? out.question.trim() : null;
  const flatMessage =
    typeof out.message === "string" && out.message.trim() ? out.message.trim() : null;
  const inner =
    out.output && typeof out.output === "object" && out.output !== null
      ? (out.output as Record<string, unknown>)
      : out;
  const innerQuestion =
    inner && typeof inner.question === "string" && inner.question.trim()
      ? inner.question.trim()
      : null;
  const innerMessage =
    inner && typeof inner.message === "string" && inner.message.trim()
      ? inner.message.trim()
      : null;
  const question = flatQuestion ?? innerQuestion ?? flatMessage ?? innerMessage ?? undefined;
  const opts = Array.isArray(inner?.suggestions)
    ? inner.suggestions
    : Array.isArray(inner?.options)
      ? inner.options
      : Array.isArray(out.suggestions)
        ? out.suggestions
        : Array.isArray(out.options)
          ? out.options
          : [];
  const options = opts.map((o) => String(o)).filter(Boolean);
  // #region agent log
  fetch("http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      location: "agent-request/route.ts:GET",
      message: "agent-request returning",
      data: {
        runId,
        rawType: typeof raw,
        rawLen: typeof raw === "string" ? raw.length : 0,
        outKeys: Object.keys(out),
        questionLen: question?.length ?? 0,
        optionsLen: options.length,
      },
      hypothesisId: "H2",
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  return json({ question, options });
}
