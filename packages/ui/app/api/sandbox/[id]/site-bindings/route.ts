import { json } from "../../../_lib/response";
import {
  db,
  sandboxes,
  sandboxSiteBindings,
  toSandboxSiteBindingRow,
  fromSandboxSiteBindingRow,
  fromSandboxRow,
  type SandboxSiteBinding,
} from "../../../_lib/db";
import { eq } from "drizzle-orm";
import { PodmanManager } from "@agentos-studio/runtime";

export const runtime = "nodejs";

const podman = new PodmanManager();

const PORT_START = Math.max(1, parseInt(process.env.SANDBOX_PORT_START ?? "18100", 10));
const PORT_END = Math.max(PORT_START + 1, parseInt(process.env.SANDBOX_PORT_END ?? "18200", 10));

type Params = { params: Promise<{ id: string }> };

async function allocateHostPort(): Promise<number> {
  const rows = await db.select().from(sandboxSiteBindings);
  const used = new Set(rows.map((r) => (r as { hostPort: number }).hostPort));
  for (let p = PORT_START; p < PORT_END; p++) {
    if (!used.has(p)) return p;
  }
  throw new Error("No free sandbox port. Set SANDBOX_PORT_START / SANDBOX_PORT_END.");
}

export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(sandboxSiteBindings).where(eq(sandboxSiteBindings.sandboxId, id));
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

  const sandboxRows = await db.select().from(sandboxes).where(eq(sandboxes.id, sandboxId));
  if (sandboxRows.length === 0) return json({ error: "Sandbox not found" }, { status: 404 });
  const sb = fromSandboxRow(sandboxRows[0]);

  const hostNorm = host.toLowerCase().trim();
  const existing = await db.select().from(sandboxSiteBindings).where(eq(sandboxSiteBindings.host, hostNorm));
  if (existing.length > 0) return json({ error: "Host already bound" }, { status: 409 });

  const hostPort = await allocateHostPort();
  const binding: SandboxSiteBinding = {
    id: crypto.randomUUID(),
    sandboxId,
    host: hostNorm,
    containerPort: Number(containerPort),
    hostPort,
    createdAt: Date.now(),
  };
  await db.insert(sandboxSiteBindings).values(toSandboxSiteBindingRow(binding)).run();

  const updatedConfig = {
    ...sb.config,
    network: true,
    ports: { ...(sb.config?.ports ?? {}), [String(hostPort)]: binding.containerPort },
  };

  if (sb.containerId) {
    try {
      await podman.destroy(sb.containerId);
    } catch {
      // ignore
    }
    try {
      const newContainerId = await podman.create(sb.image, sb.name, updatedConfig);
      await db.update(sandboxes).set({
        status: "running",
        containerId: newContainerId,
        config: JSON.stringify(updatedConfig),
      }).where(eq(sandboxes.id, sandboxId)).run();
    } catch {
      await db.update(sandboxes).set({
        status: "stopped",
        containerId: null,
        config: JSON.stringify(updatedConfig),
      }).where(eq(sandboxes.id, sandboxId)).run();
      return json({ ...binding, warning: "Container recreate failed. Restart sandbox to apply." }, { status: 201 });
    }
  } else {
    await db.update(sandboxes).set({ config: JSON.stringify(updatedConfig) }).where(eq(sandboxes.id, sandboxId)).run();
  }

  return json(binding, { status: 201 });
}
