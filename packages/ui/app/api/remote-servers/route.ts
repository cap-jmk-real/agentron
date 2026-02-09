import { json } from "../_lib/response";
import { db, remoteServers, fromRemoteServerRow, toRemoteServerRow } from "../_lib/db";
import type { RemoteServer } from "../_lib/db";

export const runtime = "nodejs";

export async function GET() {
  const rows = await db.select().from(remoteServers);
  return json({ servers: rows.map(fromRemoteServerRow) });
}

export async function POST(request: Request) {
  const body = await request.json();
  const id = crypto.randomUUID();
  const server: RemoteServer = {
    id,
    label: body.label ?? "Remote server",
    host: body.host,
    port: body.port ?? 22,
    user: body.user,
    authType: body.authType === "password" ? "password" : "key",
    keyPath: body.keyPath ?? undefined,
    modelBaseUrl: body.modelBaseUrl ?? undefined,
    createdAt: Date.now(),
  };
  await db.insert(remoteServers).values(toRemoteServerRow(server)).run();
  return json({ id, ...server });
}
