/**
 * Tool handlers for workflow CRUD: delete_workflow, list_workflow_versions, rollback_workflow.
 */
import type { ExecuteToolContext } from "./execute-tool-shared";
import { resolveWorkflowIdFromArgs } from "./execute-tool-shared";
import { db, workflows, workflowVersions } from "../../_lib/db";
import { eq, desc } from "drizzle-orm";

export const WORKFLOW_TOOL_NAMES = [
  "delete_workflow",
  "list_workflow_versions",
  "rollback_workflow",
] as const;

export async function handleWorkflowTools(
  name: string,
  a: Record<string, unknown>,
  _ctx: ExecuteToolContext | undefined
): Promise<unknown> {
  switch (name) {
    case "delete_workflow": {
      const wfResolved = resolveWorkflowIdFromArgs(a);
      if ("error" in wfResolved) return { error: wfResolved.error };
      const wfId = wfResolved.workflowId;
      const wfRows = await db
        .select({ id: workflows.id, name: workflows.name })
        .from(workflows)
        .where(eq(workflows.id, wfId));
      if (wfRows.length === 0) return { error: "Workflow not found" };
      await db.delete(workflows).where(eq(workflows.id, wfId)).run();
      return { id: wfId, message: `Workflow "${wfRows[0].name}" deleted` };
    }
    case "list_workflow_versions": {
      const wfResolved = resolveWorkflowIdFromArgs(a);
      if ("error" in wfResolved) return { error: wfResolved.error };
      const wfId = wfResolved.workflowId;
      const exists = await db
        .select({ id: workflows.id })
        .from(workflows)
        .where(eq(workflows.id, wfId))
        .limit(1);
      if (exists.length === 0) return { error: "Workflow not found" };
      const rows = await db
        .select({
          id: workflowVersions.id,
          version: workflowVersions.version,
          createdAt: workflowVersions.createdAt,
        })
        .from(workflowVersions)
        .where(eq(workflowVersions.workflowId, wfId))
        .orderBy(desc(workflowVersions.version));
      return rows.map((r) => ({ id: r.id, version: r.version, created_at: r.createdAt }));
    }
    case "rollback_workflow": {
      const wfResolved = resolveWorkflowIdFromArgs(a);
      if ("error" in wfResolved) return { error: wfResolved.error };
      const wfId = wfResolved.workflowId;
      const versionId = a.versionId as string | undefined;
      const versionNum = typeof a.version === "number" ? a.version : undefined;
      const exists = await db
        .select({ id: workflows.id })
        .from(workflows)
        .where(eq(workflows.id, wfId))
        .limit(1);
      if (exists.length === 0) return { error: "Workflow not found" };
      let versionRow:
        | { id: string; workflowId: string; version: number; snapshot: string }
        | undefined;
      if (versionId) {
        const rows = await db
          .select()
          .from(workflowVersions)
          .where(eq(workflowVersions.id, versionId))
          .limit(1);
        versionRow =
          rows.length > 0 && rows[0].workflowId === wfId
            ? (rows[0] as { id: string; workflowId: string; version: number; snapshot: string })
            : undefined;
      } else if (versionNum != null) {
        const rows = await db
          .select()
          .from(workflowVersions)
          .where(eq(workflowVersions.workflowId, wfId));
        versionRow = rows.find((r) => r.version === versionNum) as
          | { id: string; workflowId: string; version: number; snapshot: string }
          | undefined;
      }
      if (!versionRow) return { error: "Version not found (provide versionId or version)" };
      let snapshot: Record<string, unknown>;
      try {
        snapshot = JSON.parse(versionRow.snapshot) as Record<string, unknown>;
      } catch {
        return { error: "Invalid snapshot" };
      }
      if (String(snapshot.id) !== wfId) return { error: "Snapshot does not match workflow" };
      await db
        .update(workflows)
        .set(snapshot as Record<string, unknown>)
        .where(eq(workflows.id, wfId))
        .run();
      return { id: wfId, version: versionRow.version, message: "Workflow rolled back" };
    }
    default:
      return undefined;
  }
}
