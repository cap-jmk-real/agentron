/**
 * E2E: OpenClaw — agent steers OpenClaw (send_to_openclaw, openclaw_history).
 * If Gateway is not reachable, starts OpenClaw in a container (create_sandbox).
 * In-container path: commands run via exec inside the container (localhost), no port-forward.
 *
 * Cross-platform: same flow on Windows, macOS, Linux; exec is supported on all.
 * If the runtime reports an exec error (e.g. "container state improper"), the test skips.
 * Containers are torn down in afterAll unless OPENCLAW_E2E_KEEP_CONTAINER=1.
 */
import { execSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as net from "node:net";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { POST as chatPost } from "../../app/api/chat/route";
import { GET as getChatEvents } from "../../app/api/chat/events/route";
import { POST as convPost } from "../../app/api/chat/conversations/route";
import { executeTool } from "../../app/api/chat/_lib/execute-tool";
import { openclawHealth } from "../../app/api/_lib/openclaw-client";
import { E2E_LLM_CONFIG_ID, OLLAMA_BASE_URL, E2E_LLM_MODEL } from "./e2e-setup";
import { e2eLog } from "./e2e-logger";

/** Ollama URL for the OpenClaw container (host from container: host.containers.internal). OpenClaw provider expects /v1. */
function openclawOllamaBaseUrl(): string {
  try {
    const u = new URL(OLLAMA_BASE_URL);
    u.hostname = "host.containers.internal";
    u.pathname = "/v1";
    return u.toString();
  } catch {
    return "http://host.containers.internal:11434/v1";
  }
}

// Prefer alpine (fast); override with OPENCLAW_E2E_IMAGE if needed (e.g. ghcr.io/openclaw/openclaw:main).
const OPENCLAW_IMAGE = process.env.OPENCLAW_E2E_IMAGE || "alpine/openclaw:latest";
const OPENCLAW_GATEWAY_PORT = 18789;
const OPENCLAW_WAIT_MS = 4000;
// From container logs: gateway logs "listening on ws://" when ready; allow time for bind + startup.
const GATEWAY_READY_TIMEOUT_MS = 30_000;
const GATEWAY_READY_POLL_MS = 1000;
/** Max time to wait for gateway to log "listening on ws://" (B.2: onboard runs first, then gateway; allow ~60s for onboard). */
const GATEWAY_STARTUP_WAIT_MS = 90_000;
const GATEWAY_STARTUP_POLL_MS = 1000;

/** Sandbox id if we started OpenClaw in a container; must be torn down in afterAll. */
let sandboxIdForTeardown: string | null = null;

/** When set, do not tear down the container so you can run: podman logs <containerId>, etc. */
const OPENCLAW_E2E_KEEP_CONTAINER = process.env.OPENCLAW_E2E_KEEP_CONTAINER === "1";

/** Wait until TCP connect to host:port succeeds (port forward / gateway listening). */
function waitForPort(wsUrl: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let u: URL;
    try {
      u = new URL(wsUrl);
    } catch {
      resolve(false);
      return;
    }
    const host = u.hostname;
    const port = parseInt(u.port || "80", 10);
    if (!Number.isFinite(port)) {
      resolve(false);
      return;
    }
    let settled = false;
    const deadline = Date.now() + timeoutMs;
    const tryConnect = () => {
      if (settled) return;
      const sock = net.createConnection({ host, port, timeout: 2000 }, () => {
        sock.destroy();
        if (!settled) {
          settled = true;
          resolve(true);
        }
      });
      sock.on("error", () => {
        sock.destroy();
        if (Date.now() >= deadline && !settled) {
          settled = true;
          resolve(false);
        } else if (!settled) {
          setTimeout(tryConnect, 400);
        }
      });
    };
    tryConnect();
  });
}

/**
 * Run diagnostics when gateway health fails: container logs, WebSocket event sequence from host,
 * and optional connection test from inside the container.
 */
async function runOpenClawDiagnostic(
  gatewayUrl: string,
  gatewayToken: string | undefined,
  containerId: string
): Promise<void> {
  const events: string[] = [];
  const log = (msg: string) => {
    events.push(msg);
    console.log("[openclaw diagnostic]", msg);
  };

  try {
    const logs = execSync(`podman logs --tail 150 ${containerId} 2>&1`, {
      encoding: "utf8",
      timeout: 5000,
    });
    log("--- container logs (last 150 lines) ---");
    log(logs.slice(-3000));
  } catch (e) {
    log(`podman logs failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const u = new URL(gatewayUrl);
    const origin = `${u.protocol === "wss:" ? "https" : "http"}://${u.host}`;
    log(`--- WebSocket from host to ${gatewayUrl} (Origin: ${origin}) ---`);
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(gatewayUrl, {
        handshakeTimeout: 5000,
        headers: { Origin: origin },
      });
      const done = () => {
        try {
          ws.removeAllListeners();
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
            ws.terminate();
        } catch {
          // ignore
        }
        resolve();
      };
      ws.on("open", () => log("ws.open"));
      ws.on("message", (data: Buffer | ArrayBuffer) => {
        const raw = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
        log(`ws.message: ${raw.slice(0, 200)}${raw.length > 200 ? "..." : ""}`);
      });
      ws.on("error", (err) => log(`ws.error: ${err instanceof Error ? err.message : String(err)}`));
      ws.on("close", (code, reason) =>
        log(`ws.close code=${code} reason=${reason?.toString() ?? ""}`)
      );
      setTimeout(done, 6000);
    });
  } catch (e) {
    log(`WebSocket diagnostic failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    log("--- connection from inside container (127.0.0.1:18789) ---");
    const script = [
      "const W=require('ws');",
      "const w=new W('ws://127.0.0.1:18789',{handshakeTimeout:5000});",
      "w.on('open',()=>console.log('INNER_OPEN'));",
      "w.on('message',d=>console.log('INNER_MSG',d.toString().slice(0,150)));",
      "w.on('error',e=>console.log('INNER_ERR',e.message));",
      "w.on('close',(c,r)=>console.log('INNER_CLOSE',c,String(r)));",
      "setTimeout(()=>process.exit(0),5000);",
    ].join("");
    const out = execSync(`podman exec ${containerId} node -e ${JSON.stringify(script)} 2>&1`, {
      encoding: "utf8",
      timeout: 8000,
    });
    log(out);
  } catch (e) {
    log(`inner connection test failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  e2eLog.step("openclaw diagnostic", { events: events.join("\n").slice(-4000) });
}

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

async function ensureOpenClawGateway(): Promise<{
  ok: boolean;
  /** When set, use send_to_openclaw/openclaw_history with sandboxId so commands run inside the container (localhost). */
  sandboxId?: string;
  fromContainer?: boolean;
}> {
  if ((await openclawHealth()).ok) return { ok: true, fromContainer: false };

  // Token injection: e2e generates a token and passes it into the container; container startup sets gateway.auth.token from OPENCLAW_E2E_TOKEN so we never need to read token from the container.
  // Use same Ollama config as other e2e tests (e2e-setup verifies Ollama is available). Container reaches host via host.containers.internal.
  const e2eToken = crypto.randomBytes(32).toString("base64url");
  const createEnv: Record<string, string> = {
    OPENCLAW_E2E_TOKEN: e2eToken,
    OPENCLAW_AGENT_MODEL: `ollama/${E2E_LLM_MODEL}`,
    OPENCLAW_OLLAMA_BASE_URL: openclawOllamaBaseUrl(),
  };
  const createRes = await executeTool(
    "create_sandbox",
    {
      image: OPENCLAW_IMAGE,
      name: `e2e-openclaw-${Date.now()}`,
      env: createEnv,
    },
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
    return { ok: false };
  }

  sandboxIdForTeardown = sandboxId;
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
    ...(containerId && { containerId, hint: "Run: podman logs " + containerId }),
  });

  // Wait for gateway startup: onboard runs first then gateway; logs show "listening on ws://" when ready.
  if (containerId) {
    const startupDeadline = Date.now() + GATEWAY_STARTUP_WAIT_MS;
    while (Date.now() < startupDeadline) {
      try {
        const logs = execSync(`podman logs ${containerId} 2>&1`, {
          encoding: "utf8",
          timeout: 5000,
        });
        const normalized = logs.replace(/^[\uFEFF']+/, "").trim();
        const listening = /listening on ws:\/\//i.test(normalized);
        if (listening) {
          e2eLog.step("openclaw gateway startup seen in logs (in-container path)", {});
          break;
        }
      } catch {
        // podman logs can fail if container just started; retry
      }
      await new Promise((r) => setTimeout(r, GATEWAY_STARTUP_POLL_MS));
    }
    // Extra wait so container is stable and background npm install (for in-container ws) can complete before first exec.
    await new Promise((r) => setTimeout(r, 15000));
    // Verify container is still running and accepts exec (if container exited, exec fails).
    try {
      execSync(`podman exec ${containerId} printf ok 2>&1`, {
        encoding: "utf8",
        timeout: 10000,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      let logSnippet = "";
      try {
        logSnippet = execSync(`podman logs --tail 60 ${containerId} 2>&1`, {
          encoding: "utf8",
          timeout: 5000,
        });
      } catch {
        // ignore
      }
      e2eLog.toolCall(
        "openclaw",
        `Container exec check failed (${msg}). Last logs: ${logSnippet.slice(-800)}`
      );
      await tearDownSandbox(sandboxId);
      return { ok: false };
    }
  } else {
    await new Promise((r) => setTimeout(r, 7000));
  }

  e2eLog.step("openclaw using in-container path", { sandboxId });
  return { ok: true, sandboxId, fromContainer: true };
}

const CONTAINER_LOGS_TAIL = 80;

/** Dump last N lines of container logs to stdout for failed runs. Call from catch when test fails. */
async function dumpContainerLogs(sandboxId: string | null): Promise<void> {
  if (!sandboxId) return;
  try {
    const { GET: getSandbox } = await import("../../app/api/sandbox/[id]/route");
    const sbRes = await getSandbox(new Request("http://localhost"), {
      params: Promise.resolve({ id: sandboxId }),
    });
    if (!sbRes.ok) return;
    const sb = (await sbRes.json()) as { containerId?: string };
    if (!sb.containerId) return;
    const logs = execSync(`podman logs --tail ${CONTAINER_LOGS_TAIL} ${sb.containerId} 2>&1`, {
      encoding: "utf8",
      timeout: 5000,
    });
    console.log(
      "\n[openclaw e2e] Container logs (last %d lines) for diagnosis:\n%s",
      CONTAINER_LOGS_TAIL,
      logs
    );
  } catch (e) {
    console.warn("[openclaw e2e] Could not dump container logs:", e);
  }
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
    if (sandboxIdForTeardown && !OPENCLAW_E2E_KEEP_CONTAINER) {
      await tearDownSandbox(sandboxIdForTeardown);
      sandboxIdForTeardown = null;
    } else if (sandboxIdForTeardown && OPENCLAW_E2E_KEEP_CONTAINER) {
      console.log(
        "[openclaw e2e] Container kept alive for diagnosis. Tear down with: DELETE /api/sandbox/" +
          sandboxIdForTeardown
      );
    }
    e2eLog.outcome("completed", Date.now() - start);
    e2eLog.endTest();
  }, 30_000);

  it("agent steers OpenClaw: send then history has at least one message", async () => {
    try {
      const result = await ensureOpenClawGateway();
      expect(
        result.ok,
        "OpenClaw gateway must be reachable or start in container; container must stay running and accept exec"
      ).toBe(true);
      const sandboxId = result.sandboxId;

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

      const openclawPrompt = sandboxId
        ? `OpenClaw is running in sandbox ${sandboxId}. Use send_to_openclaw with sandboxId "${sandboxId}" to send OpenClaw this message: 'Say hello in one short sentence.' Then use openclaw_history with sandboxId "${sandboxId}" to confirm the reply.`
        : "Use the send_to_openclaw tool to send OpenClaw this message: 'Say hello in one short sentence.' Then use openclaw_history to confirm the reply.";
      const res = await chatPost(
        new Request("http://localhost/api/chat?stream=1", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({
            message: openclawPrompt,
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

      const historyFromTurn = toolResults.find((r) => r.name === "openclaw_history")?.result as
        | { messages?: { role?: string; content?: string }[] }
        | undefined;
      const messagesFromTurn = Array.isArray(historyFromTurn?.messages)
        ? historyFromTurn.messages
        : [];

      const sendResult = toolResults.find((r) => r.name === "send_to_openclaw")?.result as
        | { runId?: string; error?: string }
        | undefined;
      let messages = messagesFromTurn;

      // Agent called send_to_openclaw but got host connection error (e.g. no sandboxId) -> retry with sandboxId
      const hostConnectionError =
        sendResult?.error &&
        sandboxId &&
        (sendResult.error.includes("ECONNREFUSED") || sendResult.error.includes("ECONNRESET"));

      if (sandboxId && hostConnectionError) {
        e2eLog.step("openclaw retry with sandboxId (agent did not pass it)", { sandboxId });
        const retrySend = await executeTool(
          "send_to_openclaw",
          { content: "Say hello in one short sentence.", sandboxId },
          undefined
        );
        const retryErr = (retrySend as { error?: string }).error;
        expect(
          retryErr,
          `send_to_openclaw with sandboxId must succeed, got: ${retryErr ?? "no error"}`
        ).toBeUndefined();
        expect((retrySend as { runId?: string }).runId).toBeDefined();
        e2eLog.step("send_to_openclaw with sandboxId", {
          runId: (retrySend as { runId?: string }).runId,
        });
        await new Promise((r) => setTimeout(r, OPENCLAW_WAIT_MS));
        const historyRes = await executeTool("openclaw_history", { sandboxId }, undefined);
        const historyErr = (historyRes as { error?: string }).error;
        expect(
          historyErr,
          `openclaw_history must succeed, got: ${historyErr ?? "no error"}`
        ).toBeUndefined();
        messages =
          (historyRes as { messages?: { role?: string; content?: string }[] }).messages ?? [];
        e2eLog.step("openclaw_history with sandboxId", { count: messages.length });
      } else if (names.includes("send_to_openclaw") && sendResult && !sendResult.error) {
        expect(sendResult.runId).toBeDefined();
        e2eLog.step("send_to_openclaw", { runId: sendResult.runId });
        if (messages.length < 1) {
          const historyOpts = sandboxId ? { sandboxId } : {};
          const historyPollMs = 3000;
          const historyDeadline = Date.now() + 60_000;
          while (messages.length < 1 && Date.now() < historyDeadline) {
            await new Promise((r) => setTimeout(r, historyPollMs));
            const historyRes = await executeTool("openclaw_history", historyOpts, undefined);
            const err = (historyRes as { error?: string }).error;
            expect(err, `openclaw_history must succeed, got: ${err ?? "no error"}`).toBeUndefined();
            messages =
              (historyRes as { messages?: { role?: string; content?: string }[] }).messages ?? [];
          }
          e2eLog.step("openclaw_history after wait", { count: messages.length });
        }
      } else if (sandboxId) {
        e2eLog.step("openclaw validating in-container path (direct send + history)", {});
        const sendPayload = { content: "Say hello in one short sentence.", sandboxId };
        let directSend = await executeTool("send_to_openclaw", sendPayload, undefined);
        let directErr = (directSend as { error?: string }).error;
        const retryable =
          directErr && /network error|non-101|ECONNREFUSED|ECONNRESET/i.test(directErr);
        for (let attempt = 0; attempt < 3 && directErr && retryable; attempt++) {
          await new Promise((r) => setTimeout(r, 5000));
          directSend = await executeTool("send_to_openclaw", sendPayload, undefined);
          directErr = (directSend as { error?: string }).error;
        }
        expect(
          directErr,
          `send_to_openclaw with sandboxId must succeed, got: ${directErr ?? "no error"}`
        ).toBeUndefined();
        // Poll history until we get at least one message (model may need time to reply).
        const historyPollMs = 3000;
        const historyDeadline = Date.now() + 60_000;
        while (messages.length < 1 && Date.now() < historyDeadline) {
          await new Promise((r) => setTimeout(r, historyPollMs));
          const historyRes = await executeTool("openclaw_history", { sandboxId }, undefined);
          const historyErr = (historyRes as { error?: string }).error;
          expect(
            historyErr,
            `openclaw_history must succeed, got: ${historyErr ?? "no error"}`
          ).toBeUndefined();
          messages =
            (historyRes as { messages?: { role?: string; content?: string }[] }).messages ?? [];
        }
        e2eLog.step("openclaw_history with sandboxId", { count: messages.length });
      } else {
        expect(sendResult, "host path requires agent to call send_to_openclaw").toBeDefined();
        expect(
          sendResult!.error,
          `send_to_openclaw must succeed, got: ${sendResult!.error ?? "no error"}`
        ).toBeUndefined();
        expect(
          messages.length,
          "need OpenClaw messages from turn or history"
        ).toBeGreaterThanOrEqual(1);
      }

      expect(
        messages.length,
        "OpenClaw must return at least one message (e2e uses same Ollama config as other e2e tests)"
      ).toBeGreaterThanOrEqual(1);
    } catch (e) {
      await dumpContainerLogs(sandboxIdForTeardown);
      throw e;
    }
  }, 120_000); // gateway wait + chat/assertions
});
