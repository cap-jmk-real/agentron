import { json } from "../../_lib/response";
import { db, remoteServers, fromRemoteServerRow, toRemoteServerRow } from "../../_lib/db";
import { eq } from "drizzle-orm";
import type { RemoteServer } from "../../_lib/db";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(remoteServers).where(eq(remoteServers.id, id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });
  return json(fromRemoteServerRow(rows[0]));
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(remoteServers).where(eq(remoteServers.id, id));
  if (rows.length === 0) return json({ error: "Not found" }, { status: 404 });
  const body = await request.json();
  const existing = fromRemoteServerRow(rows[0]);
  const updated: RemoteServer = {
    ...existing,
    label: body.label ?? existing.label,
    host: body.host ?? existing.host,
    port: body.port ?? existing.port,
    user: body.user ?? existing.user,
    authType: body.authType ?? existing.authType,
    keyPath: body.keyPath !== undefined ? body.keyPath : existing.keyPath,
    modelBaseUrl: body.modelBaseUrl !== undefined ? body.modelBaseUrl : existing.modelBaseUrl,
  };
  await db.update(remoteServers).set(toRemoteServerRow(updated)).where(eq(remoteServers.id, id)).run();
  return json(updated);
}

export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params;
  await db.delete(remoteServers).where(eq(remoteServers.id, id)).run();
  return json({ message: "Deleted" });
}
