import { json } from "../../../_lib/response";
import { db, executions, workflows, agents, fromExecutionRow } from "../../../_lib/db";
import { getExecutionLogForRun } from "../../../_lib/execution-log";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/** GET /api/runs/:id/trace — returns run metadata, execution trail, and execution log (LLM/tool steps) for debugging. */
export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(executions).where(eq(executions.id, id));
  if (rows.length === 0) {
    return json({ error: "Not found" }, { status: 404 });
  }
  const run = fromExecutionRow(rows[0]);
  const output = run.output;
  const trail =
    output != null &&
    typeof output === "object" &&
    !Array.isArray(output) &&
    "trail" in (output as object) &&
    Array.isArray((output as { trail?: unknown[] }).trail)
      ? (output as { trail: unknown[] }).trail
      : [];

  const executionLogSteps = await getExecutionLogForRun(id);

  let targetName: string | undefined;
  if (run.targetType === "workflow") {
    const wf = await db.select({ name: workflows.name }).from(workflows).where(eq(workflows.id, run.targetId));
    targetName = wf[0]?.name;
  } else if (run.targetType === "agent") {
    const ag = await db.select({ name: agents.name }).from(agents).where(eq(agents.id, run.targetId));
    targetName = ag[0]?.name;
  }

  return json({
    id: run.id,
    targetType: run.targetType,
    targetId: run.targetId,
    targetName,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    trail,
    executionLog: executionLogSteps,
  });
}
