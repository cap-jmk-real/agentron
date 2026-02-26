/**
 * Tool handlers for guardrails: create_guardrail, list_guardrails, get_guardrail, update_guardrail, delete_guardrail.
 */
import type { ExecuteToolContext } from "./execute-tool-shared";
import { db, guardrails } from "../../_lib/db";
import { eq } from "drizzle-orm";

function parseGuardrailConfig(
  config: string | Record<string, unknown> | null
): Record<string, unknown> {
  if (config == null) return {};
  if (typeof config === "object") return config;
  try {
    return (JSON.parse(config || "{}") as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

export const GUARDRAILS_TOOL_NAMES = [
  "create_guardrail",
  "list_guardrails",
  "get_guardrail",
  "update_guardrail",
  "delete_guardrail",
] as const;

export async function handleGuardrailTools(
  name: string,
  a: Record<string, unknown>,
  _ctx: ExecuteToolContext | undefined
): Promise<unknown> {
  switch (name) {
    case "create_guardrail": {
      const id = crypto.randomUUID();
      const scope = (a.scope as string) || "deployment";
      const scopeId = (a.scopeId as string) || null;
      const config =
        a.config != null && typeof a.config === "object"
          ? (a.config as Record<string, unknown>)
          : {};
      await db
        .insert(guardrails)
        .values({ id, scope, scopeId, config: JSON.stringify(config), createdAt: Date.now() })
        .run();
      return {
        id,
        message: "Guardrail created. It will be applied when the agent uses fetch/browser.",
      };
    }
    case "list_guardrails": {
      const scope = a.scope as string | undefined;
      const scopeId = a.scopeId as string | undefined;
      let rows = await db.select().from(guardrails);
      if (scope) rows = rows.filter((r) => r.scope === scope);
      if (scopeId) rows = rows.filter((r) => r.scopeId === scopeId);
      return {
        guardrails: rows.map((r) => ({
          id: r.id,
          scope: r.scope,
          scopeId: r.scopeId,
          config: parseGuardrailConfig(r.config),
        })),
      };
    }
    case "get_guardrail": {
      const gid = a.id as string;
      const rows = await db.select().from(guardrails).where(eq(guardrails.id, gid));
      if (rows.length === 0) return { error: "Guardrail not found" };
      const r = rows[0];
      return {
        id: r.id,
        scope: r.scope,
        scopeId: r.scopeId,
        config: parseGuardrailConfig(r.config),
      };
    }
    case "update_guardrail": {
      const gid = typeof a.id === "string" ? (a.id as string).trim() : "";
      if (!gid) return { error: "id required" };
      const config =
        a.config != null && typeof a.config === "object" ? JSON.stringify(a.config) : undefined;
      if (!config) return { error: "config required" };
      await db.update(guardrails).set({ config }).where(eq(guardrails.id, gid)).run();
      return { id: gid, message: "Guardrail updated." };
    }
    case "delete_guardrail": {
      const gid = typeof a.id === "string" ? (a.id as string).trim() : "";
      if (!gid) return { error: "id required" };
      await db.delete(guardrails).where(eq(guardrails.id, gid)).run();
      return { message: "Guardrail deleted." };
    }
    default:
      return undefined;
  }
}
