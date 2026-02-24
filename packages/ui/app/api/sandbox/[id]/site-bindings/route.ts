import { json } from "../../../_lib/response";
import { db, sandboxSiteBindings, fromSandboxSiteBindingRow } from "../../../_lib/db";
import { addSandboxSiteBinding } from "../../../_lib/sandbox-site-bindings";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db
    .select()
    .from(sandboxSiteBindings)
    .where(eq(sandboxSiteBindings.sandboxId, id));
  return json(rows.map(fromSandboxSiteBindingRow));
}

export async function POST(request: Request, { params }: Params) {
  const { id: sandboxId } = await params;
  let body: { host: string; containerPort: number };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { host, containerPort } = body;
  if (!host || containerPort == null) {
    return json({ error: "host and containerPort are required" }, { status: 400 });
  }

  try {
    const { binding, warning } = await addSandboxSiteBinding(
      sandboxId,
      host,
      Number(containerPort)
    );
    return json(warning ? { ...binding, warning } : binding, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "Sandbox not found") return json({ error: "Sandbox not found" }, { status: 404 });
    if (msg.includes("already bound")) return json({ error: msg }, { status: 409 });
    if (msg.includes("No free sandbox port")) return json({ error: msg }, { status: 503 });
    return json({ error: msg }, { status: 400 });
  }
}
