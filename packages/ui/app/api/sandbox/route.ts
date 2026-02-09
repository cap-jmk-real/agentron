import { json } from "../_lib/response";
import { db, sandboxes, toSandboxRow, fromSandboxRow } from "../_lib/db";
import type { Sandbox } from "@agentron-studio/core";
import { PodmanManager } from "@agentron-studio/runtime";

export const runtime = "nodejs";

const podman = new PodmanManager();

export async function GET() {
  const rows = await db.select().from(sandboxes);
  return json(rows.map(fromSandboxRow));
}

export async function POST(request: Request) {
  const payload = await request.json();
  const id = crypto.randomUUID();

  const sb: Sandbox = {
    id,
    name: payload.name || `sandbox-${id.slice(0, 8)}`,
    image: payload.image || "node:22-slim",
    status: "creating",
    config: payload.config ?? {},
    createdAt: Date.now()
  };

  await db.insert(sandboxes).values(toSandboxRow(sb)).run();

  try {
    const containerId = await podman.create(sb.image, sb.name, sb.config);
    sb.status = "running";
    sb.containerId = containerId;
    await db.update(sandboxes).set({ status: "running", containerId }).where(
      (await import("drizzle-orm")).eq(sandboxes.id, id)
    ).run();
  } catch (err: unknown) {
    sb.status = "stopped";
    await db.update(sandboxes).set({ status: "stopped" }).where(
      (await import("drizzle-orm")).eq(sandboxes.id, id)
    ).run();
  }

  return json(sb, { status: 201 });
}
