import { json } from "../../../_lib/response";
import { db, executions, fromExecutionRow, executionOutputSuccess } from "../../../_lib/db";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/** Submit user response to a run that is waiting_for_user. Clears the pending state (run marked completed with user response). */
export async function POST(request: Request, { params }: Params) {
  const { id: runId } = await params;
  const rows = await db.select().from(executions).where(eq(executions.id, runId));
  if (rows.length === 0) {
    return json({ error: "Not found" }, { status: 404 });
  }
  const run = rows[0];
  if (run.status !== "waiting_for_user") {
    return json({ error: "Run is not waiting for user input", status: run.status }, { status: 400 });
  }
  let body: { response?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const response = typeof body.response === "string" ? body.response.trim() : "";
  const output = executionOutputSuccess(
    { userResponded: true, response: response || "(no text)" },
    []
  );
  await db
    .update(executions)
    .set({
      status: "completed",
      finishedAt: Date.now(),
      output: JSON.stringify(output),
    })
    .where(eq(executions.id, runId))
    .run();
  const updated = await db.select().from(executions).where(eq(executions.id, runId));
  return json(fromExecutionRow(updated[0]));
}
