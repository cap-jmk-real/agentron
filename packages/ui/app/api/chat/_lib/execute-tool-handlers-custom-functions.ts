/**
 * Tool handlers for custom code functions: create_code_tool, list_custom_functions, get_custom_function, update_custom_function, create_custom_function.
 */
import type { ExecuteToolContext } from "./execute-tool-shared";
import { ensureRunnerSandboxId } from "./execute-tool-shared";
import {
  db,
  customFunctions,
  tools,
  fromCustomFunctionRow,
  toCustomFunctionRow,
  fromToolRow,
  toToolRow,
} from "../../_lib/db";
import { withContainerInstallHint } from "../../_lib/container-manager";
import { eq } from "drizzle-orm";

export const CUSTOM_FUNCTIONS_TOOL_NAMES = [
  "create_code_tool",
  "list_custom_functions",
  "get_custom_function",
  "update_custom_function",
  "create_custom_function",
] as const;

export async function handleCustomFunctionTools(
  name: string,
  a: Record<string, unknown>,
  _ctx: ExecuteToolContext | undefined
): Promise<unknown> {
  switch (name) {
    case "create_code_tool": {
      const nameStr = a.name != null && String(a.name).trim() ? String(a.name).trim() : "";
      const lang =
        a.language != null && String(a.language).trim()
          ? String(a.language).trim().toLowerCase()
          : "";
      const sourceStr = typeof a.source === "string" ? a.source : "";
      if (!nameStr) return { error: "name is required" };
      if (!["javascript", "python", "typescript"].includes(lang))
        return { error: "language must be javascript, python, or typescript" };
      if (!sourceStr) return { error: "source is required" };
      let sandboxId: string;
      try {
        sandboxId = await ensureRunnerSandboxId(lang);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { error: withContainerInstallHint(msg) };
      }
      const fnId = crypto.randomUUID();
      const fn = {
        id: fnId,
        name: nameStr,
        language: lang as "javascript" | "python" | "typescript",
        source: sourceStr,
        description:
          a.description != null && String(a.description).trim()
            ? String(a.description).trim()
            : undefined,
        sandboxId,
        createdAt: Date.now(),
      };
      await db.insert(customFunctions).values(toCustomFunctionRow(fn)).run();
      const toolId = `fn-${fnId}`;
      const tool = {
        id: toolId,
        name: fn.name,
        protocol: "native" as const,
        config: { functionId: fnId, language: fn.language },
        inputSchema:
          a.inputSchema != null && typeof a.inputSchema === "object"
            ? (a.inputSchema as Record<string, unknown>)
            : undefined,
        outputSchema: undefined,
      };
      await db.insert(tools).values(toToolRow(tool)).run();
      return {
        id: fnId,
        toolId,
        name: fn.name,
        message: `Code tool "${fn.name}" created. Tool id: ${toolId}. You can attach it to agents via update_agent with toolIds.`,
      };
    }
    case "list_custom_functions": {
      const fnRows = await db.select().from(customFunctions);
      const toolRows = await db.select({ id: tools.id, config: tools.config }).from(tools);
      const functionIdToToolId = new Map<string, string>();
      for (const row of toolRows) {
        const config =
          typeof row.config === "string"
            ? (JSON.parse(row.config || "{}") as Record<string, unknown>)
            : (row.config as Record<string, unknown>);
        const fid = config?.functionId as string | undefined;
        if (typeof fid === "string") functionIdToToolId.set(fid, row.id);
      }
      const list = fnRows.map((row) => {
        const fn = fromCustomFunctionRow(row);
        const toolId =
          functionIdToToolId.get(fn.id) ??
          (toolRows.some((t) => t.id === `fn-${fn.id}`) ? `fn-${fn.id}` : undefined);
        return {
          id: fn.id,
          name: fn.name,
          language: fn.language,
          description: fn.description ?? undefined,
          ...(toolId ? { toolId } : {}),
        };
      });
      return list;
    }
    case "get_custom_function": {
      const fid = typeof a.id === "string" ? a.id.trim() : "";
      if (!fid) return { error: "id is required" };
      const fnRows = await db.select().from(customFunctions).where(eq(customFunctions.id, fid));
      if (fnRows.length === 0) return { error: "Custom function not found" };
      const fn = fromCustomFunctionRow(fnRows[0]);
      return {
        id: fn.id,
        name: fn.name,
        description: fn.description,
        language: fn.language,
        source: fn.source,
        sandboxId: fn.sandboxId,
      };
    }
    case "update_custom_function": {
      const fid = typeof a.id === "string" ? a.id.trim() : "";
      if (!fid) return { error: "id is required" };
      const fnRows = await db.select().from(customFunctions).where(eq(customFunctions.id, fid));
      if (fnRows.length === 0) return { error: "Custom function not found" };
      const existing = fromCustomFunctionRow(fnRows[0]);
      const updated = { ...existing };
      if (a.source !== undefined) updated.source = String(a.source);
      if (a.name !== undefined) updated.name = String(a.name);
      if (a.description !== undefined)
        updated.description = String(a.description).trim() || undefined;
      if (a.sandboxId !== undefined)
        updated.sandboxId =
          typeof a.sandboxId === "string" && a.sandboxId.trim() ? a.sandboxId.trim() : undefined;
      await db
        .update(customFunctions)
        .set(toCustomFunctionRow(updated))
        .where(eq(customFunctions.id, fid))
        .run();
      return { id: fid, message: `Custom function "${updated.name}" updated` };
    }
    case "create_custom_function": {
      const id = crypto.randomUUID();
      const fn = {
        id,
        name: a.name as string,
        language: a.language as string,
        source: a.source as string,
        description: (a.description as string) || undefined,
        createdAt: Date.now(),
      };
      await db.insert(customFunctions).values(toCustomFunctionRow(fn)).run();
      return { id, name: fn.name, message: `Function "${fn.name}" created` };
    }
    default:
      return undefined;
  }
}
