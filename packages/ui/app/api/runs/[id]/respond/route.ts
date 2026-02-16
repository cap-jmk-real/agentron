import { json } from "../../../_lib/response";
import { db, executions, fromExecutionRow, executionOutputSuccess } from "../../../_lib/db";
import { runWorkflowForRun } from "../../../_lib/run-workflow";
import { enqueueWorkflowRun } from "../../../_lib/workflow-queue";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/** Submit user response to a run that is waiting_for_user. Merges the response into the run output (preserving trail), sets status to running, and resumes the workflow so the agent continues. */
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
  const responseText = typeof body.response === "string" ? body.response.trim() : "";
  const response = responseText || "(no text)";
  const current = (() => {
    try {
      const raw = run.output;
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      return undefined;
    }
  })();
  const existingOutput = current && typeof current === "object" && !Array.isArray(current) && current.output !== undefined ? current.output : undefined;
  const existingTrail = Array.isArray(current?.trail) ? current.trail : [];
  const mergedOutput = {
    ...(existingOutput && typeof existingOutput === "object" && !Array.isArray(existingOutput) ? existingOutput : {}),
    userResponded: true,
    response,
  };
  const payload = executionOutputSuccess(mergedOutput, existingTrail.length > 0 ? existingTrail : undefined);
  await db
    .update(executions)
    .set({
      status: "running",
      finishedAt: null,
      output: JSON.stringify(payload),
    })
    .where(eq(executions.id, runId))
    .run();
  enqueueWorkflowRun(() => runWorkflowForRun(runId, { resumeUserResponse: response }));
  const updated = await db.select().from(executions).where(eq(executions.id, runId));
  return json(fromExecutionRow(updated[0]));
}
