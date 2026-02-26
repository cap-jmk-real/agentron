/**
 * Tool handlers for agent/store key-value: create_store, put_store, get_store, query_store, list_stores, delete_store.
 */
import type { ExecuteToolContext } from "./execute-tool-shared";
import { db, agentStoreEntries } from "../../_lib/db";
import { eq, and } from "drizzle-orm";

export const STORES_TOOL_NAMES = [
  "create_store",
  "put_store",
  "get_store",
  "query_store",
  "list_stores",
  "delete_store",
] as const;

export async function handleStoreTools(
  name: string,
  a: Record<string, unknown>,
  _ctx: ExecuteToolContext | undefined
): Promise<unknown> {
  switch (name) {
    case "create_store": {
      const scope = (a.scope as string) || "agent";
      const scopeId = (a.scopeId as string) || "";
      const storeName = (a.name as string) || "";
      if (!scopeId || !storeName) return { error: "scopeId and name required" };
      return {
        message: "Store is created when you first put_store a key. No separate create needed.",
      };
    }
    case "put_store": {
      const scope = (a.scope as string) || "agent";
      const scopeId = typeof a.scopeId === "string" ? a.scopeId.trim() : "";
      const storeName = typeof a.storeName === "string" ? a.storeName.trim() : "";
      const key = typeof a.key === "string" ? a.key.trim() : "";
      if (!storeName) return { error: "Missing required field: storeName" };
      if (!key) return { error: "Missing required field: key" };
      const value = typeof a.value === "string" ? a.value : JSON.stringify(a.value ?? "");
      const id = crypto.randomUUID();
      const existing = await db
        .select()
        .from(agentStoreEntries)
        .where(
          and(
            eq(agentStoreEntries.scope, scope),
            eq(agentStoreEntries.scopeId, scopeId),
            eq(agentStoreEntries.storeName, storeName),
            eq(agentStoreEntries.key, key)
          )
        );
      if (existing.length > 0) {
        await db
          .update(agentStoreEntries)
          .set({ value })
          .where(eq(agentStoreEntries.id, existing[0].id))
          .run();
        return { message: "Updated." };
      }
      await db
        .insert(agentStoreEntries)
        .values({ id, scope, scopeId, storeName, key, value, createdAt: Date.now() })
        .run();
      return { message: "Stored." };
    }
    case "get_store": {
      const scope = (a.scope as string) || "agent";
      const scopeId = (a.scopeId as string) || "";
      const storeName = (a.storeName as string) || "";
      const key = (a.key as string) || "";
      const rows = await db
        .select()
        .from(agentStoreEntries)
        .where(
          and(
            eq(agentStoreEntries.scope, scope),
            eq(agentStoreEntries.scopeId, scopeId),
            eq(agentStoreEntries.storeName, storeName),
            eq(agentStoreEntries.key, key)
          )
        );
      if (rows.length === 0) return { error: "Key not found" };
      return { value: rows[0].value };
    }
    case "query_store": {
      const scope = (a.scope as string) || "agent";
      const scopeId = (a.scopeId as string) || "";
      const storeName = (a.storeName as string) || "";
      const prefix = (a.prefix as string) || "";
      const rows = await db
        .select()
        .from(agentStoreEntries)
        .where(
          and(
            eq(agentStoreEntries.scope, scope),
            eq(agentStoreEntries.scopeId, scopeId),
            eq(agentStoreEntries.storeName, storeName)
          )
        );
      const filtered = prefix ? rows.filter((r) => r.key.startsWith(prefix)) : rows;
      return { entries: filtered.map((r) => ({ key: r.key, value: r.value })) };
    }
    case "list_stores": {
      const scope = (a.scope as string) || "agent";
      const scopeId = (a.scopeId as string) || "";
      const rows = await db
        .select({ storeName: agentStoreEntries.storeName })
        .from(agentStoreEntries)
        .where(and(eq(agentStoreEntries.scope, scope), eq(agentStoreEntries.scopeId, scopeId)));
      const names = [...new Set(rows.map((r) => r.storeName))];
      return { stores: names };
    }
    case "delete_store": {
      const scope = (a.scope as string) || "agent";
      const scopeId = (a.scopeId as string) || "";
      const storeName = (a.storeName as string) || "";
      await db
        .delete(agentStoreEntries)
        .where(
          and(
            eq(agentStoreEntries.scope, scope),
            eq(agentStoreEntries.scopeId, scopeId),
            eq(agentStoreEntries.storeName, storeName)
          )
        )
        .run();
      return { message: "Store deleted." };
    }
    default:
      return undefined;
  }
}
