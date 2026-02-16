import { json } from "../../_lib/response";
import { db, executions, workflows, agents } from "../../_lib/db";
import { eq, inArray } from "drizzle-orm";

/** Returns count and list of runs waiting for user input. Used by sidebar (count) and chat (list with question/target). */
export async function GET(_request?: Request) {
  const rows = await db
    .select({ id: executions.id, targetType: executions.targetType, targetId: executions.targetId, output: executions.output })
    .from(executions)
    .where(eq(executions.status, "waiting_for_user"));

  const workflowIds = [...new Set(rows.filter((r) => r.targetType === "workflow").map((r) => r.targetId))];
  const agentIds = [...new Set(rows.filter((r) => r.targetType === "agent").map((r) => r.targetId))];
  const workflowNames: Record<string, string> = {};
  const agentNames: Record<string, string> = {};
  if (workflowIds.length > 0) {
    const wf = await db.select({ id: workflows.id, name: workflows.name }).from(workflows).where(inArray(workflows.id, workflowIds));
    for (const w of wf) workflowNames[w.id] = w.name ?? "";
  }
  if (agentIds.length > 0) {
    const ag = await db.select({ id: agents.id, name: agents.name }).from(agents).where(inArray(agents.id, agentIds));
    for (const a of ag) agentNames[a.id] = a.name ?? "";
  }

  const requests = rows.map((r) => {
    let question = "Needs your input";
    let reason: string | undefined;
    let suggestions: string[] | undefined;
    if (r.output) {
      try {
        const out = JSON.parse(r.output) as { question?: string; reason?: string; message?: string; suggestions?: string[] };
        if (typeof out.question === "string" && out.question.trim()) question = out.question.trim();
        reason = typeof out.reason === "string" && out.reason.trim() ? out.reason.trim() : (typeof out.message === "string" && out.message.trim() ? out.message.trim() : undefined);
        if (Array.isArray(out.suggestions)) {
          suggestions = out.suggestions.filter((s): s is string => typeof s === "string").slice(0, 20);
        }
      } catch {
        // ignore
      }
    }
    const targetName = r.targetType === "workflow" ? workflowNames[r.targetId] : r.targetType === "agent" ? agentNames[r.targetId] : "";
    return { runId: r.id, question, reason, suggestions, targetName: targetName || r.targetId, targetType: r.targetType };
  });

  return json({ count: rows.length, requests });
}
