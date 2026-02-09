import { json } from "../_lib/response";
import { db, sandboxSiteBindings, fromSandboxSiteBindingRow } from "../_lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("hosts") === "1") {
    const rows = await db.select({ host: sandboxSiteBindings.host }).from(sandboxSiteBindings);
    return json({ hosts: rows.map((r) => r.host) });
  }
  const rows = await db.select().from(sandboxSiteBindings);
  return json(rows.map(fromSandboxSiteBindingRow));
}
