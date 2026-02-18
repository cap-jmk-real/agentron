import { json } from "../_lib/response";
import { listNotifications } from "../_lib/notifications-store";
import type { NotificationType } from "../_lib/notifications-store";
import { db, executions, workflows, agents } from "../_lib/db";
import { eq, inArray } from "drizzle-orm";

export const runtime = "nodejs";

/** GET /api/notifications — list notifications. Query: status (default active), types (run,chat), limit, offset. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = (searchParams.get("status") as "active" | "cleared" | null) ?? "active";
  const typesParam = searchParams.get("types");
  const types: NotificationType[] | undefined =
    typesParam != null && typesParam !== ""
      ? (typesParam.split(",").map((t) => t.trim()).filter(Boolean) as NotificationType[])
      : undefined;
  const limit = Math.min(Number(searchParams.get("limit")) || 50, 200);
  const offset = Math.max(0, Number(searchParams.get("offset")) || 0);

  const { items, totalActiveCount } = listNotifications({ status, types, limit, offset });

  // Enrich run notifications with targetName (workflow/agent name)
  const runIds = [...new Set(items.filter((n) => n.type === "run").map((n) => n.sourceId))];
  const runIdToTargetName: Record<string, string> = {};
  if (runIds.length > 0) {
    const rows = await db
      .select({ id: executions.id, targetType: executions.targetType, targetId: executions.targetId })
      .from(executions)
      .where(inArray(executions.id, runIds));
    const workflowIds = [...new Set(rows.filter((r) => r.targetType === "workflow").map((r) => r.targetId))];
    const agentIds = [...new Set(rows.filter((r) => r.targetType === "agent").map((r) => r.targetId))];
    const nameByTargetId: Record<string, string> = {};
    if (workflowIds.length > 0) {
      const wf = await db.select({ id: workflows.id, name: workflows.name }).from(workflows).where(inArray(workflows.id, workflowIds));
      for (const w of wf) nameByTargetId[w.id] = w.name ?? "";
    }
    if (agentIds.length > 0) {
      const ag = await db.select({ id: agents.id, name: agents.name }).from(agents).where(inArray(agents.id, agentIds));
      for (const a of ag) nameByTargetId[a.id] = a.name ?? "";
    }
    for (const r of rows) {
      const name = nameByTargetId[r.targetId];
      if (name) runIdToTargetName[r.id] = name;
    }
  }

  const enriched = items.map((n) => {
    if (n.type === "run") {
      const targetName = runIdToTargetName[n.sourceId];
      return { ...n, targetName: targetName ?? (n.metadata?.targetId as string) ?? n.sourceId };
    }
    return n;
  });

  return json({ items: enriched, totalActiveCount });
}
