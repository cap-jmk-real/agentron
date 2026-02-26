/**
 * Tool handlers for remote servers: list_remote_servers, test_remote_connection, save_remote_server.
 */
import type { ExecuteToolContext } from "./execute-tool-shared";
import type { RemoteServer } from "../../_lib/db";
import { db, remoteServers, fromRemoteServerRow, toRemoteServerRow } from "../../_lib/db";
import { testRemoteConnection } from "../../_lib/remote-test";

export const REMOTE_SERVERS_TOOL_NAMES = [
  "list_remote_servers",
  "test_remote_connection",
  "save_remote_server",
] as const;

export async function handleRemoteServerTools(
  name: string,
  a: Record<string, unknown>,
  _ctx: ExecuteToolContext | undefined
): Promise<unknown> {
  switch (name) {
    case "list_remote_servers": {
      const rows = await db.select().from(remoteServers);
      return {
        servers: rows.map(fromRemoteServerRow).map((s) => ({
          id: s.id,
          label: s.label,
          host: s.host,
          port: s.port,
          user: s.user,
          authType: s.authType,
          modelBaseUrl: s.modelBaseUrl,
        })),
      };
    }
    case "test_remote_connection": {
      const host = a.host as string;
      const user = a.user as string;
      if (!host || !user) return { error: "host and user are required" };
      return testRemoteConnection({
        host,
        port: a.port as number | undefined,
        user,
        authType: (a.authType as string) || "key",
        keyPath: a.keyPath as string | undefined,
      });
    }
    case "save_remote_server": {
      const host = typeof a.host === "string" ? a.host.trim() : "";
      const user = typeof a.user === "string" ? a.user.trim() : "";
      if (!host) return { error: "host is required" };
      if (!user) return { error: "user is required" };
      const rawPort = Number(a.port);
      const port =
        Number.isNaN(rawPort) || rawPort < 1 || rawPort > 65535 ? 22 : Math.floor(rawPort);
      const id = crypto.randomUUID();
      const server: RemoteServer = {
        id,
        label: (a.label as string) || "Remote server",
        host,
        port,
        user,
        authType: a.authType === "password" ? "password" : "key",
        keyPath: (a.keyPath as string) || undefined,
        modelBaseUrl: (a.modelBaseUrl as string) || undefined,
        createdAt: Date.now(),
      };
      await db.insert(remoteServers).values(toRemoteServerRow(server)).run();
      return {
        id,
        message: `Saved remote server "${server.label}". You can use it when creating new agents. Passwords are not stored; for password auth the user will be prompted when using this server.`,
        server: {
          id: server.id,
          label: server.label,
          host: server.host,
          port: server.port,
          user: server.user,
        },
      };
    }
    default:
      return undefined;
  }
}
