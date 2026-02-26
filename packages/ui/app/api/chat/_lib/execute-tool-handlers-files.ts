/**
 * Tool handlers for uploaded context files: list_files.
 */
import type { ExecuteToolContext } from "./execute-tool-shared";
import { db, files, fromFileRow } from "../../_lib/db";

export const FILES_TOOL_NAMES = ["list_files"] as const;

export async function handleFileTools(
  name: string,
  a: Record<string, unknown>,
  _ctx: ExecuteToolContext | undefined
): Promise<unknown> {
  if (name !== "list_files") return undefined;
  const rows = await db.select().from(files);
  return rows.map(fromFileRow).map((f) => ({ id: f.id, name: f.name, size: f.size }));
}
