import { json } from "../../../_lib/response";
import { db, executions, fromExecutionRow, executionOutputSuccess, runLogs } from "../../../_lib/db";
import { enqueueWorkflowResume } from "../../../_lib/workflow-queue";
import { getVaultKeyFromRequest } from "../../../_lib/vault";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";

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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'runs/[id]/respond/route.ts',message:'respond rejected run not waiting',data:{runId,status:run.status},hypothesisId:'vault_access',timestamp:Date.now()})}).catch(()=>{});
    // #endregion
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
  const vaultKey = getVaultKeyFromRequest(request);
  const replyPreview = response.length > 80 ? response.slice(0, 77) + "…" : response;
  await db.insert(runLogs).values({
    id: crypto.randomUUID(),
    executionId: runId,
    level: "stdout",
    message: `User replied (run page): ${replyPreview}`,
    payload: null,
    createdAt: Date.now(),
  }).run();
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/3176dc2d-c7b9-4633-bc70-1216077b8573',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'runs/[id]/respond/route.ts',message:'respond API enqueueing resume',data:{runId,responseLen:response.length,hasVaultKey:!!vaultKey},hypothesisId:'vault_access',timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  await enqueueWorkflowResume({ runId, resumeUserResponse: response });
  const updated = await db.select().from(executions).where(eq(executions.id, runId));
  return json(fromExecutionRow(updated[0]));
}
