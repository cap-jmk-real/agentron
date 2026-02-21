/**
 * Shared logic for adding a sandbox site binding (expose container port to host).
 * Used by POST /api/sandbox/[id]/site-bindings and by the bind_sandbox_port tool handler.
 */
import {
  db,
  sandboxes,
  sandboxSiteBindings,
  toSandboxSiteBindingRow,
  fromSandboxRow,
  fromSandboxSiteBindingRow,
  type SandboxSiteBinding,
} from "./db";
import { getContainerManager } from "./container-manager";
import { eq, and } from "drizzle-orm";

const PORT_START = Math.max(1, parseInt(process.env.SANDBOX_PORT_START ?? "18100", 10));
const PORT_END = Math.max(PORT_START + 1, parseInt(process.env.SANDBOX_PORT_END ?? "18200", 10));

export async function allocateHostPort(): Promise<number> {
  const rows = await db.select().from(sandboxSiteBindings);
  const used = new Set(rows.map((r) => (r as { hostPort: number }).hostPort));
  for (let p = PORT_START; p < PORT_END; p++) {
    if (!used.has(p)) return p;
  }
  throw new Error("No free sandbox port. Set SANDBOX_PORT_START / SANDBOX_PORT_END.");
}

export type AddBindingResult = {
  binding: SandboxSiteBinding;
  warning?: string;
};

/**
 * Add a site binding for a sandbox (container port -> host port). Allocates a free host port,
 * persists the binding, and updates sandbox config (recreating the container if it was running).
 * Returns the binding; optional warning if container recreate failed.
 */
export async function addSandboxSiteBinding(
  sandboxId: string,
  host: string,
  containerPort: number
): Promise<AddBindingResult> {
  const sandboxRows = await db.select().from(sandboxes).where(eq(sandboxes.id, sandboxId));
  if (sandboxRows.length === 0) throw new Error("Sandbox not found");
  const sb = fromSandboxRow(sandboxRows[0]);

  const hostNorm = host.toLowerCase().trim();

  // Allow multiple bindings with same host for different sandboxes (each gets distinct hostPort)
  const existingSameSandbox = await db
    .select()
    .from(sandboxSiteBindings)
    .where(
      and(
        eq(sandboxSiteBindings.sandboxId, sandboxId),
        eq(sandboxSiteBindings.containerPort, containerPort)
      )
    );
  if (existingSameSandbox.length > 0) {
    const b = fromSandboxSiteBindingRow(existingSameSandbox[0]);
    throw new Error(
      `Port ${containerPort} already bound for this sandbox (host port ${b.hostPort})`
    );
  }

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

  let warning: string | undefined;
  if (sb.containerId) {
    const podman = getContainerManager();
    try {
      await podman.destroy(sb.containerId);
    } catch {
      // ignore
    }
    try {
      const newContainerId = await podman.create(sb.image, sb.name, updatedConfig);
      await db
        .update(sandboxes)
        .set({
          status: "running",
          containerId: newContainerId,
          config: JSON.stringify(updatedConfig),
        })
        .where(eq(sandboxes.id, sandboxId))
        .run();
    } catch {
      await db
        .update(sandboxes)
        .set({
          status: "stopped",
          containerId: null,
          config: JSON.stringify(updatedConfig),
        })
        .where(eq(sandboxes.id, sandboxId))
        .run();
      warning = "Container recreate failed. Restart sandbox to apply binding.";
    }
  } else {
    await db
      .update(sandboxes)
      .set({ config: JSON.stringify(updatedConfig) })
      .where(eq(sandboxes.id, sandboxId))
      .run();
  }

  return { binding, warning };
}
