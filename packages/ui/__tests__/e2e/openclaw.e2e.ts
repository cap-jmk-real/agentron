/**
 * E2E: OpenClaw — agent steers real OpenClaw instance (send_to_openclaw, openclaw_history).
 * If Gateway is not reachable, starts OpenClaw in a container (create_sandbox + bind_sandbox_port),
 * then runs the test. Containers spawned for e2e are always torn down in afterAll.
 * See docs/openclaw-e2e-plan.md.
 */
import { execSync } from "node:child_process";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { POST as chatPost } from "../../app/api/chat/route";
import { GET as getChatEvents } from "../../app/api/chat/events/route";
import { POST as convPost } from "../../app/api/chat/conversations/route";
import { executeTool } from "../../app/api/chat/_lib/execute-tool";
import { openclawHealth } from "../../app/api/_lib/openclaw-client";
import { E2E_LLM_CONFIG_ID } from "./e2e-setup";
import { e2eLog } from "./e2e-logger";

const OPENCLAW_IMAGE = "alpine/openclaw:latest";
const OPENCLAW_GATEWAY_PORT = 18789;
const OPENCLAW_WAIT_MS = 4000;
// From container logs: gateway logs "listening on ws://" when ready; allow time for bind + startup.
const GATEWAY_READY_TIMEOUT_MS = 30_000;
const GATEWAY_READY_POLL_MS = 1000;
/** Max time to wait for gateway to log "listening on ws://" (inferred from podman logs). */
const GATEWAY_STARTUP_WAIT_MS = 15_000;
const GATEWAY_STARTUP_POLL_MS = 1000;

/** Sandbox id if we started OpenClaw in a container; must be torn down in afterAll. */
let sandboxIdForTeardown: string | null = null;

async function readEventStream(
  turnId: string
): Promise<{ type?: string; toolResults?: { name: string; result?: unknown }[] }[]> {
  const res = await getChatEvents(
    new Request(`http://localhost/api/chat/events?turnId=${encodeURIComponent(turnId)}`)
  );
  if (!res.ok || !res.body) return [];
  const decoder = new TextDecoder();
  let buffer = "";
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value);
    if (done) break;
  }
  reader.releaseLock();
  const events: { type?: string; toolResults?: { name: string; result?: unknown }[] }[] = [];
  for (const chunk of buffer.split("\n\n").filter((s) => s.trim())) {
    const m = chunk.match(/^data:\s*(.+)$/m);
    if (m) {
      try {
        events.push(JSON.parse(m[1].trim()));
      } catch {
        // skip
      }
    }
  }
  return events;
}

async function ensureOpenClawGateway(): Promise<boolean> {
  if ((await openclawHealth()).ok) return true;

  const createRes = await executeTool(
    "create_sandbox",
    { image: OPENCLAW_IMAGE, name: "e2e-openclaw" },
    undefined
  );
  const err = (createRes as { error?: string }).error;
  const sandboxId = (createRes as { id?: string }).id;
  const status = (createRes as { status?: string }).status;
  if (err || !sandboxId || status !== "running") {
    e2eLog.toolCall(
      "openclaw",
      `Could not start OpenClaw container (${err ?? status ?? "unknown"}). Skip.`
    );
    return false;
  }

  const bindRes = await executeTool(
    "bind_sandbox_port",
    { sandboxId, containerPort: OPENCLAW_GATEWAY_PORT },
    undefined
  );
  const bindErr = (bindRes as { error?: string }).error;
  const websocketUrl = (bindRes as { websocketUrl?: string }).websocketUrl;
  if (bindErr || !websocketUrl) {
    e2eLog.toolCall("openclaw", `Could not bind port (${bindErr ?? "no URL"}). Skip.`);
    await tearDownSandbox(sandboxId);
    return false;
  }

  sandboxIdForTeardown = sandboxId;
  process.env.OPENCLAW_GATEWAY_URL = websocketUrl;
  process.env.OPENCLAW_GATEWAY_TOKEN = "e2e-openclaw-token";
  let containerId: string | undefined;
  try {
    const { GET: getSandbox } = await import("../../app/api/sandbox/[id]/route");
    const sbRes = await getSandbox(new Request("http://localhost"), {
      params: Promise.resolve({ id: sandboxId }),
    });
    if (sbRes.ok) {
      const sb = (await sbRes.json()) as { containerId?: string };
      containerId = sb.containerId;
    }
  } catch {
    // ignore
  }
  e2eLog.step("openclaw container started", {
    sandboxId,
    websocketUrl,
    ...(containerId && { containerId, hint: "Run: podman logs " + containerId }),
  });

  // Wait for gateway startup: podman logs show "listening on ws://" then "Browser control service ready".
  if (containerId) {
    const startupDeadline = Date.now() + GATEWAY_STARTUP_WAIT_MS;
    while (Date.now() < startupDeadline) {
      try {
        const logs = execSync(`podman logs ${containerId} 2>&1`, {
          encoding: "utf8",
          timeout: 5000,
        });
        const normalized = logs.replace(/^[\uFEFF']+/, "").trim();
        if (/\[gateway\]\s+listening on ws:\/\//i.test(normalized)) {
          e2eLog.step("openclaw gateway startup seen in logs", {});
          break;
        }
      } catch {
        // podman logs can fail if container just started; retry
      }
      await new Promise((r) => setTimeout(r, GATEWAY_STARTUP_POLL_MS));
    }
    // After "listening", browser/service logs "generated gateway.auth.token automatically" then "Browser control service ready".
    // Give it a moment so config is written before we read token.
    await new Promise((r) => setTimeout(r, 2000));
  } else {
    await new Promise((r) => setTimeout(r, 7000));
  }

  // Read token from the fresh container (OpenClaw: gateway.auth.token in ~/.openclaw/openclaw.json).
  // Gateway may write config after "generated gateway.auth.token automatically"; try twice.
  for (const attempt of [0, 1]) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000));
    try {
      const execRes = await executeTool(
        "execute_code",
        {
          sandboxId,
          command: "cat /home/node/.openclaw/openclaw.json 2>/dev/null || true",
        },
        undefined
      );
      const err = (execRes as { error?: string }).error;
      const out = ((execRes as { stdout?: string }).stdout ?? "").trim();
      if (!err && out) {
        const parsed = JSON.parse(out) as { gateway?: { auth?: { token?: string } } };
        const token = parsed?.gateway?.auth?.token?.trim();
        if (token) {
          process.env.OPENCLAW_GATEWAY_TOKEN = token;
          e2eLog.step("openclaw token read from container", {});
          break;
        }
      }
    } catch {
      // keep e2e-openclaw-token or previous value
    }
  }

  const gatewayWaitStart = Date.now();
  const deadline = gatewayWaitStart + GATEWAY_READY_TIMEOUT_MS;
  let lastError: string | undefined;
  while (Date.now() < deadline) {
    const health = await openclawHealth();
    if (health.ok) {
      const elapsedMs = Date.now() - gatewayWaitStart;
      e2eLog.step("openclaw gateway ready", { elapsedMs });
      console.log(`OPENCLAW_GATEWAY_READY_MS=${elapsedMs}`);
      return true;
    }
    lastError = health.error;
    await new Promise((r) => setTimeout(r, GATEWAY_READY_POLL_MS));
  }
  if (containerId) {
    try {
      const logs = execSync(`podman logs --tail 80 ${containerId}`, {
        encoding: "utf8",
        timeout: 5000,
      });
      e2eLog.step("openclaw container logs (last 80 lines)", {
        containerId,
        logPreview: logs.slice(-1500),
      });
    } catch (e) {
      e2eLog.toolCall("openclaw", `Could not get podman logs: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  e2eLog.toolCall("openclaw", `Gateway did not become ready. Last error: ${lastError ?? "unknown"}`);
  return false;
}

async function tearDownSandbox(sandboxId: string): Promise<void> {
  try {
    const { DELETE: deleteSandbox } = await import("../../app/api/sandbox/[id]/route");
    const res = await deleteSandbox(new Request("http://localhost"), {
      params: Promise.resolve({ id: sandboxId }),
    });
    if (res.ok) e2eLog.step("openclaw sandbox torn down", { sandboxId });
  } catch (e) {
    e2eLog.toolCall("openclaw teardown", String(e));
  }
}

describe("e2e openclaw", () => {
  const start = Date.now();

  beforeAll(() => {
    e2eLog.startTest("openclaw");
    e2eLog.scenario("openclaw", "Agent steers OpenClaw: send_to_openclaw then openclaw_history");
  });

  afterAll(async () => {
    if (sandboxIdForTeardown) {
      await tearDownSandbox(sandboxIdForTeardown);
      sandboxIdForTeardown = null;
    }
    e2eLog.outcome("completed", Date.now() - start);
    e2eLog.endTest();
  }, 30_000);

  it("agent steers OpenClaw: send command then assert history has at least one message", async () => {
    const gatewayOk = await ensureOpenClawGateway();
    expect(
      gatewayOk,
      "OpenClaw gateway must be reachable (or start in container) and become ready within timeout; check e2e logs for last health error"
    ).toBe(true);

    const createRes = await convPost(
      new Request("http://localhost/api/chat/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "E2E OpenClaw" }),
      })
    );
    const conv = await createRes.json();
    const conversationId = conv.id as string;
    expect(typeof conversationId).toBe("string");
    e2eLog.step("create_conversation", { conversationId });

    const res = await chatPost(
      new Request("http://localhost/api/chat?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          message: "Ask OpenClaw to say hello in one short sentence.",
          conversationId,
          providerId: E2E_LLM_CONFIG_ID,
          useHeapMode: true,
        }),
      })
    );
    expect(res).toBeDefined();
    expect(res!.status).toBe(202);
    const data = await res!.json();
    const turnId = data.turnId;
    expect(typeof turnId).toBe("string");

    const events = await readEventStream(turnId);
    const doneEvent = events.find((e) => e?.type === "done");
    expect(doneEvent).toBeDefined();
    const toolResults =
      (doneEvent as { toolResults?: { name: string; result?: unknown }[] } | undefined)
        ?.toolResults ?? [];
    const names = toolResults.map((r) => r.name);
    e2eLog.toolCall("chat_turn", names.join(","));

    const hasSendToOpenclaw = names.includes("send_to_openclaw");
    expect(hasSendToOpenclaw).toBe(true);
    const sendResult = toolResults.find((r) => r.name === "send_to_openclaw")?.result as
      | { runId?: string; error?: string }
      | undefined;
    expect(sendResult).toBeDefined();
    expect(sendResult?.error).toBeUndefined();
    expect(sendResult?.runId).toBeDefined();
    e2eLog.step("send_to_openclaw", { runId: sendResult?.runId });

    const historyFromTurn = toolResults.find((r) => r.name === "openclaw_history")?.result as
      | { messages?: { role?: string; content?: string }[] }
      | undefined;
    const messagesFromTurn = Array.isArray(historyFromTurn?.messages)
      ? historyFromTurn.messages
      : [];

    if (messagesFromTurn.length >= 1) {
      expect(messagesFromTurn.length).toBeGreaterThanOrEqual(1);
      e2eLog.step("openclaw_history from turn", { count: messagesFromTurn.length });
    } else {
      await new Promise((r) => setTimeout(r, OPENCLAW_WAIT_MS));
      const historyRes = await executeTool("openclaw_history", {}, undefined);
      const err = (historyRes as { error?: string }).error;
      const messages =
        (historyRes as { messages?: { role?: string; content?: string }[] }).messages ?? [];
      expect(err).toBeUndefined();
      expect(messages.length).toBeGreaterThanOrEqual(1);
      e2eLog.step("openclaw_history after wait", { count: messages.length });
    }
  }, 120_000); // 30s gateway wait + chat/assertions
});
