import type { WebSocket } from "ws";
import type { NextRequest } from "next/server";
import { db, sandboxes, fromSandboxRow } from "../_lib/db";
import { getContainerEngine } from "../_lib/app-settings";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

/** HTTP GET is not used; clients connect via WebSocket upgrade. Return 426 so the route is valid for Next.js. */
export function GET() {
  return new Response("Use WebSocket to connect to the sandbox shell.", {
    status: 426,
    headers: { Upgrade: "websocket" },
  });
}

function getSandboxIdFromRequest(request: NextRequest): string | null {
  try {
    const url = new URL(request.url);
    return url.searchParams.get("sid") ?? url.searchParams.get("sandboxId");
  } catch {
    return null;
  }
}

export function UPGRADE(
  client: WebSocket,
  _server: import("ws").WebSocketServer,
  request: NextRequest
): void {
  const sandboxId = getSandboxIdFromRequest(request);
  if (!sandboxId?.trim()) {
    try {
      client.send(JSON.stringify({ type: "error", message: "Missing sid or sandboxId" }));
    } catch {
      /* ignore */
    }
    client.close();
    return;
  }

  void (async () => {
    let pty: import("node-pty").IPty | null = null;

    const cleanup = () => {
      try {
        if (pty) {
          pty.kill();
          pty = null;
        }
        try {
          client.close();
        } catch {
          /* ignore */
        }
      } catch {
        /* ignore */
      }
    };

    client.once("close", cleanup);

    try {
      const rows = await db.select().from(sandboxes).where(eq(sandboxes.id, sandboxId.trim()));
      if (rows.length === 0) {
        client.send(JSON.stringify({ type: "error", message: "Sandbox not found" }));
        client.close();
        return;
      }
      const sb = fromSandboxRow(rows[0]!);
      if (!sb.containerId || sb.status !== "running") {
        client.send(JSON.stringify({ type: "error", message: "Sandbox not running" }));
        client.close();
        return;
      }

      const engine = getContainerEngine();
      const shell = "/bin/sh"; // POSIX required; use /bin/bash if you prefer
      const nodePty = await import("node-pty");
      pty = nodePty.spawn(engine, ["exec", "-it", sb.containerId, shell], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: process.env.HOME || "/",
      });

      pty.onData((data: string) => {
        try {
          if (client.readyState === 1) client.send(data);
        } catch {
          cleanup();
        }
      });

      pty.onExit(() => {
        pty = null;
        cleanup();
      });

      client.on("message", (data: Buffer | string) => {
        if (!pty) return;
        const raw = typeof data === "string" ? data : data.toString("utf8");
        try {
          if (raw.startsWith("{")) {
            const msg = JSON.parse(raw) as { type?: string; cols?: number; rows?: number };
            if (
              msg.type === "resize" &&
              typeof msg.cols === "number" &&
              typeof msg.rows === "number"
            ) {
              pty.resize(msg.cols, msg.rows);
            }
            return;
          }
        } catch {
          /* not JSON, treat as input */
        }
        pty.write(raw);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        client.send(JSON.stringify({ type: "error", message }));
      } catch {
        /* ignore */
      }
      client.close();
    }
  })();
}
