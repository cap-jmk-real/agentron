/**
 * E2E: OpenClaw — agent steers OpenClaw (send_to_openclaw, openclaw_history).
 * If Gateway is not reachable, starts OpenClaw in a container (create_sandbox).
 * In-container path: commands run via exec inside the container (localhost), no port-forward.
 *
 * Cross-platform: same flow on Windows, macOS, Linux; exec is supported on all.
 * If the runtime reports an exec error (e.g. "container state improper"), the test skips.
 * Containers are torn down in afterAll unless OPENCLAW_E2E_KEEP_CONTAINER=1.
 *
 * Ollama: we prefer the user's running Ollama on the host (faster, GPU). A probe from a container checks if
 * host.containers.internal:11434 is reachable; if so, OpenClaw uses it (no extra containers). If not
 * (e.g. Windows with default Ollama binding), we start one Ollama sidecar and tear it down after the run.
 * Setup is automatic: configureOllamaForContainers() sets OLLAMA_HOST=0.0.0.0, restarts Ollama, and on
 * Windows tries to add a firewall rule for port 11434 so containers can reach the host. On Windows, if
 * the re-probe still fails, run the e2e in an elevated (admin) prompt so the firewall rule can be added.
 * To require host Ollama only (no sidecar): OPENCLAW_E2E_HOST_OLLAMA_ONLY=1.
 *
 * All tests require a real assistant reply from Ollama (e2e model, e.g. qwen3:8b). We reject the
 * error placeholder "[OpenClaw: ...]" via expectRealOllamaReply so no test passes when the run failed.
 */
import { execSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { POST as chatPost } from "../../app/api/chat/route";
import { GET as getChatEvents } from "../../app/api/chat/events/route";
import { POST as convPost } from "../../app/api/chat/conversations/route";
import { executeTool } from "../../app/api/chat/_lib/execute-tool";
import { getContainerEngine } from "../../app/api/_lib/app-settings";
import { openclawHealth } from "../../app/api/_lib/openclaw-client";
import { E2E_LLM_CONFIG_ID, OLLAMA_BASE_URL, E2E_LLM_MODEL } from "./e2e-setup";
import { e2eLog } from "./e2e-logger";

/** Network and Ollama sidecar so OpenClaw container can reach Ollama without host networking. */
const OPENCLAW_E2E_NETWORK = "openclaw-e2e-net";
const OPENCLAW_E2E_OLLAMA_CONTAINER = "openclaw-e2e-ollama";
const OLLAMA_SIDECAR_IMAGE = process.env.OPENCLAW_E2E_OLLAMA_IMAGE || "ollama/ollama";

/**
 * Ollama URL for the OpenClaw container when using the host. Uses the hostname that succeeded in the
 * probe (host.containers.internal for Podman, host.docker.internal for Docker on Windows/macOS).
 */
function openclawOllamaBaseUrl(): string {
  return `http://${hostOllamaHostname}:11434/v1`;
}

/** Ollama URL for the OpenClaw container when using the sidecar (same network). OpenClaw provider expects /v1. */
function openclawOllamaSidecarUrl(): string {
  return `http://${OPENCLAW_E2E_OLLAMA_CONTAINER}:11434/v1`;
}

// Prefer alpine (fast); override with OPENCLAW_E2E_IMAGE if needed (e.g. ghcr.io/openclaw/openclaw:main).
const OPENCLAW_IMAGE = process.env.OPENCLAW_E2E_IMAGE || "alpine/openclaw:latest";
const OPENCLAW_GATEWAY_PORT = 18789;
const OPENCLAW_WAIT_MS = 4000;
/** Ollama can take 35–50s per reply; wait up to this long for assistant reply to appear in openclaw_history. */
const OPENCLAW_REPLY_WAIT_MS = 120_000;
// From container logs: gateway logs "listening on ws://" when ready; allow time for bind + startup.
const GATEWAY_READY_TIMEOUT_MS = 30_000;
const GATEWAY_READY_POLL_MS = 1000;
/** Max time to wait for gateway to log "listening on ws://" (B.2: onboard runs first, then gateway; allow ~60s for onboard). */
const GATEWAY_STARTUP_WAIT_MS = 90_000;
const GATEWAY_STARTUP_POLL_MS = 1000;

/** Sandbox ids we started (OpenClaw containers); all torn down in afterAll. */
const sandboxIdsForTeardown: string[] = [];

/** Set when we start the Ollama sidecar so afterAll can remove it and the network. */
let ollamaSidecarStarted = false;

/** Set in beforeAll: true = use host Ollama, false = use sidecar. */
let useHostOllama = true;

/** When useHostOllama, the hostname that worked in the probe (host.containers.internal or host.docker.internal). */
let hostOllamaHostname: string = "host.containers.internal";

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

  // Per-test instances: always create a new sandbox when we need a container (no reuse).
  // Token injection: e2e generates a token and passes it into the container. Ollama URL and network were decided in beforeAll (host vs sidecar).
  const e2eToken = crypto.randomBytes(32).toString("base64url");
  const ollamaBaseUrl = useHostOllama ? openclawOllamaBaseUrl() : openclawOllamaSidecarUrl();
  const createEnv: Record<string, string> = {
    OPENCLAW_E2E_TOKEN: e2eToken,
    OPENCLAW_AGENT_MODEL: `ollama/${E2E_LLM_MODEL}`,
    OPENCLAW_OLLAMA_BASE_URL: ollamaBaseUrl,
  };
  const createPayload: {
    image: string;
    name: string;
    env: Record<string, string>;
    network?: string;
  } = {
    image: OPENCLAW_IMAGE,
    name: `e2e-openclaw-${Date.now()}`,
    env: createEnv,
  };
  if (!useHostOllama) createPayload.network = OPENCLAW_E2E_NETWORK;
  const createRes = await executeTool("create_sandbox", createPayload, undefined);
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

  sandboxIdsForTeardown.push(sandboxId);
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
    // Verify container is still running and accepts exec. Use 60s on Windows where podman exec can be slow (ETIMEDOUT).
    try {
      execSync(`podman exec ${containerId} printf ok 2>&1`, {
        encoding: "utf8",
        timeout: 60_000,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      let logSnippet = "";
      try {
        logSnippet = execSync(`podman logs --tail ${CONTAINER_LOGS_TAIL} ${containerId} 2>&1`, {
          encoding: "utf8",
          timeout: 10_000,
        });
      } catch {
        // ignore
      }
      console.warn(
        "\n[openclaw e2e] Container exec check failed. Container logs (last %d lines) for diagnosis:\n%s",
        CONTAINER_LOGS_TAIL,
        logSnippet || "(no logs)"
      );
      e2eLog.toolCall(
        "openclaw",
        `Container exec check failed (${msg}). Last logs: ${logSnippet.slice(-800)}`
      );
      await tearDownSandbox(sandboxId);
      const idx = sandboxIdsForTeardown.indexOf(sandboxId);
      if (idx >= 0) sandboxIdsForTeardown.splice(idx, 1);
      return { ok: false };
    }
  } else {
    await new Promise((r) => setTimeout(r, 7000));
  }

  e2eLog.step("openclaw using in-container path", { sandboxId });
  return { ok: true, sandboxId, fromContainer: true };
}

const CONTAINER_LOGS_TAIL = 80;

/** File to append container logs for verification (OpenClaw gateway + optional Ollama sidecar). */
const OPENCLAW_E2E_CONTAINER_LOGS =
  process.env.OPENCLAW_E2E_CONTAINER_LOGS ||
  path.join(process.cwd(), "openclaw-e2e-container-logs.log");

function appendContainerLogsToFile(header: string, logs: string): void {
  try {
    const block = `\n${"=".repeat(80)}\n${header}\n${"=".repeat(80)}\n${logs}\n`;
    fs.appendFileSync(OPENCLAW_E2E_CONTAINER_LOGS, block);
  } catch {
    // ignore
  }
}

/** Dump last N lines of container logs to stdout and to OPENCLAW_E2E_CONTAINER_LOGS for verification. Call from catch when test fails. */
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
    const header = `[${new Date().toISOString()}] OpenClaw container (sandboxId=${sandboxId}, containerId=${sb.containerId}, last ${CONTAINER_LOGS_TAIL} lines)`;
    console.log(
      "\n[openclaw e2e] Container logs (last %d lines) for diagnosis:\n%s",
      CONTAINER_LOGS_TAIL,
      logs
    );
    appendContainerLogsToFile(header, logs);
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

/** Hostnames containers use to reach the host (Podman vs Docker; works across Windows, macOS, Linux). */
const HOST_OLLAMA_CANDIDATES = ["host.containers.internal", "host.docker.internal"] as const;

/** Probe: can a container reach host Ollama? Uses the app's container engine and tries both hostnames so it works on any OS (Podman/Docker, Windows/macOS/Linux). Returns the hostname that worked or null. */
function probeHostOllamaReachable(): string | null {
  const engine = getContainerEngine() === "docker" ? "docker" : "podman";
  for (const host of HOST_OLLAMA_CANDIDATES) {
    try {
      execSync(
        `${engine} run --rm --network bridge curlimages/curl:latest curl -sf --connect-timeout 5 http://${host}:11434/api/tags 2>&1`,
        { encoding: "utf8", timeout: 15_000 }
      );
      return host;
    } catch {
      // try next hostname
    }
  }
  return null;
}

/** Ensure the Ollama sidecar and network exist so OpenClaw can reach Ollama without host networking. */
async function ensureOllamaSidecar(): Promise<void> {
  try {
    execSync(`podman network create ${OPENCLAW_E2E_NETWORK} 2>&1`, {
      encoding: "utf8",
      timeout: 10_000,
    });
  } catch {
    // Network already exists
  }
  try {
    execSync(`podman rm -f ${OPENCLAW_E2E_OLLAMA_CONTAINER} 2>&1`, {
      encoding: "utf8",
      timeout: 15_000,
    });
  } catch {
    // No existing container
  }
  // First run may pull the image; allow enough time so "Using containerized Ollama for this run" completes.
  try {
    execSync(
      `podman run -d --name ${OPENCLAW_E2E_OLLAMA_CONTAINER} --network ${OPENCLAW_E2E_NETWORK} ${OLLAMA_SIDECAR_IMAGE} 2>&1`,
      { encoding: "utf8", timeout: 300_000, stdio: "pipe" }
    );
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string; output?: string[] };
    const out = err.stdout ?? (Array.isArray(err.output) ? err.output[1] : undefined) ?? "";
    const errOut = err.stderr ?? (Array.isArray(err.output) ? err.output[2] : undefined) ?? "";
    console.error("[openclaw e2e] Ollama sidecar start failed. stdout:", out || "(empty)");
    console.error("[openclaw e2e] Ollama sidecar start failed. stderr:", errOut || "(empty)");
    if (err.message) console.error("[openclaw e2e] error message:", err.message);
    throw e;
  }
  ollamaSidecarStarted = true;
  // Wait for ollama serve to be up (a few seconds)
  const listDeadline = Date.now() + 30_000;
  while (Date.now() < listDeadline) {
    try {
      execSync(`podman exec ${OPENCLAW_E2E_OLLAMA_CONTAINER} ollama list 2>&1`, {
        encoding: "utf8",
        timeout: 10_000,
      });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  // Pull e2e model (first run may take several minutes); retry on transient network failure
  const pullAttempts = 3;
  for (let attempt = 1; attempt <= pullAttempts; attempt++) {
    try {
      execSync(`podman exec ${OPENCLAW_E2E_OLLAMA_CONTAINER} ollama pull ${E2E_LLM_MODEL} 2>&1`, {
        encoding: "utf8",
        timeout: 300_000,
        stdio: "pipe",
      });
      break;
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message?: string; output?: string[] };
      const out = err.stdout ?? (Array.isArray(err.output) ? err.output[1] : undefined) ?? "";
      const errOut = err.stderr ?? (Array.isArray(err.output) ? err.output[2] : undefined) ?? "";
      console.error(
        `[openclaw e2e] ollama pull failed (attempt ${attempt}/${pullAttempts}). stdout:`,
        out || "(empty)"
      );
      console.error("[openclaw e2e] ollama pull stderr:", errOut || "(empty)");
      if (attempt === pullAttempts) throw e;
      await new Promise((r) => setTimeout(r, 15000));
    }
  }
  e2eLog.step("openclaw ollama sidecar ready", { model: E2E_LLM_MODEL });
}

describe("e2e openclaw", () => {
  const start = Date.now();

  beforeAll(async () => {
    e2eLog.startTest("openclaw");
    e2eLog.scenario("openclaw", "Agent steers OpenClaw: send_to_openclaw then openclaw_history");
    let hostname = probeHostOllamaReachable();
    if (!hostname) {
      // Automatically configure host Ollama for container access (no manual steps).
      console.log("[openclaw e2e] Probe failed; running configureOllamaForContainers()...");
      const { configureOllamaForContainers } =
        await import("../../app/api/_lib/ollama-configure-for-containers");
      const fix = await configureOllamaForContainers();
      if (fix.ok) {
        console.log("[openclaw e2e] configureOllamaForContainers() succeeded; re-probing...");
        await new Promise((r) => setTimeout(r, 3000));
        for (let i = 0; i < 3; i++) {
          hostname = probeHostOllamaReachable();
          if (hostname) {
            console.log("[openclaw e2e] Re-probe succeeded:", hostname);
            break;
          }
          await new Promise((r) => setTimeout(r, 5000));
        }
        if (!hostname) console.log("[openclaw e2e] Re-probe failed after 3 attempts.");
      } else {
        console.log(
          "[openclaw e2e] configureOllamaForContainers() failed:",
          (fix as { error: string }).error
        );
      }
    }
    if (hostname) {
      useHostOllama = true;
      hostOllamaHostname = hostname;
      e2eLog.step("openclaw using host Ollama", { host: hostname });
    } else {
      const hostOnly = process.env.OPENCLAW_E2E_HOST_OLLAMA_ONLY === "1";
      if (hostOnly) {
        throw new Error(
          "[openclaw e2e] Host Ollama is not reachable from container, and OPENCLAW_E2E_HOST_OLLAMA_ONLY=1 (no sidecar). " +
            "To use host Ollama (GPU): (1) Start Ollama on the host. (2) Configure for containers: OLLAMA_HOST=0.0.0.0 and restart Ollama. " +
            "(3) Allow port 11434 from containers (e.g. Windows Firewall: allow inbound TCP 11434 from your WSL/Podman network). " +
            "Unset OPENCLAW_E2E_HOST_OLLAMA_ONLY to allow the sidecar fallback (slower, CPU)."
        );
      }
      console.log(
        "[openclaw e2e] Host Ollama not reachable from container. Using containerized Ollama for this run."
      );
      useHostOllama = false;
      await ensureOllamaSidecar();
    }
  }, 360_000);

  afterAll(async () => {
    // Write container logs to file for verification (OpenClaw usage, Ollama sidecar).
    const tailFinal = 200;
    for (const sandboxId of sandboxIdsForTeardown) {
      try {
        const { GET: getSandbox } = await import("../../app/api/sandbox/[id]/route");
        const sbRes = await getSandbox(new Request("http://localhost"), {
          params: Promise.resolve({ id: sandboxId }),
        });
        if (sbRes.ok) {
          const sb = (await sbRes.json()) as { containerId?: string };
          if (sb.containerId) {
            const logs = execSync(`podman logs --tail ${tailFinal} ${sb.containerId} 2>&1`, {
              encoding: "utf8",
              timeout: 10_000,
            });
            appendContainerLogsToFile(
              `[${new Date().toISOString()}] OpenClaw sandbox (sandboxId=${sandboxId}, containerId=${sb.containerId}, last ${tailFinal} lines)`,
              logs
            );
          }
        }
      } catch {
        // ignore
      }
    }
    if (ollamaSidecarStarted) {
      try {
        const logs = execSync(
          `podman logs --tail ${tailFinal} ${OPENCLAW_E2E_OLLAMA_CONTAINER} 2>&1`,
          {
            encoding: "utf8",
            timeout: 10_000,
          }
        );
        appendContainerLogsToFile(
          `[${new Date().toISOString()}] Ollama sidecar (${OPENCLAW_E2E_OLLAMA_CONTAINER}, last ${tailFinal} lines)`,
          logs
        );
      } catch {
        // ignore
      }
    }
    if (!OPENCLAW_E2E_KEEP_CONTAINER) {
      for (const id of sandboxIdsForTeardown) {
        await tearDownSandbox(id);
      }
      sandboxIdsForTeardown.length = 0;
      if (ollamaSidecarStarted) {
        try {
          execSync(`podman rm -f ${OPENCLAW_E2E_OLLAMA_CONTAINER} 2>&1`, {
            encoding: "utf8",
            timeout: 15_000,
          });
          execSync(`podman network rm ${OPENCLAW_E2E_NETWORK} 2>&1`, {
            encoding: "utf8",
            timeout: 10_000,
          });
          e2eLog.step("openclaw ollama sidecar torn down", {});
        } catch (e) {
          e2eLog.toolCall("openclaw sidecar teardown", String(e));
        }
        ollamaSidecarStarted = false;
      }
    } else if (sandboxIdsForTeardown.length > 0) {
      console.log(
        "[openclaw e2e] Containers kept alive for diagnosis. Tear down with: DELETE /api/sandbox/" +
          sandboxIdsForTeardown.join(", ")
      );
    }
    e2eLog.outcome("completed", Date.now() - start);
    e2eLog.endTest();
  }, 60_000);

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
        await waitForOpenClawReply(sandboxId);
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
        if (messages.length < 1 || !hasNonEmptyAssistantReply(messages)) {
          const historyOpts = sandboxId ? { sandboxId } : {};
          await waitForOpenClawReply(sandboxId ?? undefined, historyOpts);
          const historyRes = await executeTool("openclaw_history", historyOpts, undefined);
          const err = (historyRes as { error?: string }).error;
          expect(err, `openclaw_history must succeed, got: ${err ?? "no error"}`).toBeUndefined();
          messages =
            (historyRes as { messages?: { role?: string; content?: string }[] }).messages ?? [];
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
        await waitForOpenClawReply(sandboxId);
        const historyRes = await executeTool("openclaw_history", { sandboxId }, undefined);
        const historyErr = (historyRes as { error?: string }).error;
        expect(
          historyErr,
          `openclaw_history must succeed, got: ${historyErr ?? "no error"}`
        ).toBeUndefined();
        messages =
          (historyRes as { messages?: { role?: string; content?: string }[] }).messages ?? [];
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
      logOpenClawResponse("send then history", messages);
      expectRealOllamaReply(
        messages,
        "OpenClaw must get a real reply from Ollama (e2e model); container must reach host Ollama."
      );
    } catch (e) {
      await dumpContainerLogs(sandboxIdsForTeardown[0] ?? null);
      throw e;
    }
  }, 200_000); // gateway wait + reply wait (up to OPENCLAW_REPLY_WAIT_MS) + assertions

  it.skipIf(!useHostOllama)(
    "when host Ollama is reachable: OpenClaw gets reply from host (non-container path)",
    async () => {
      try {
        const result = await ensureOpenClawGateway();
        expect(result.ok).toBe(true);
        const sandboxId = result.sandboxId!;
        const messages = await sendAndPollHistory(
          sandboxId,
          "Say hello from host Ollama in one short sentence.",
          1,
          60_000
        );
        expect(messages.length).toBeGreaterThanOrEqual(1);
        logOpenClawResponse("host Ollama", messages);
        expectRealOllamaReply(messages, "Host Ollama path must return real reply.");
        e2eLog.step("host Ollama reply", { count: messages.length });
      } catch (e) {
        await dumpContainerLogs(sandboxIdsForTeardown[0] ?? null);
        throw e;
      }
    }
  );

  /** Normalize OpenClaw message content to a single string. Prefer reply (real model text) when present, else content. */
  function getMessageText(msg: { content?: unknown; reply?: string } | undefined): string {
    if (msg && typeof (msg as { reply?: string }).reply === "string")
      return (msg as { reply: string }).reply;
    function extractText(val: unknown): string {
      if (typeof val === "string") return val;
      if (Array.isArray(val)) return val.map(extractText).join("");
      if (typeof val === "object" && val !== null) {
        const o = val as Record<string, unknown>;
        if (typeof o.text === "string") return o.text;
        if (typeof o.content === "string") return o.content;
        return Object.values(o).map(extractText).join("");
      }
      return "";
    }
    const c = msg?.content;
    const out = extractText(c);
    if (out) return out;
    const fallback = String(c ?? "");
    return fallback === "[object Object]" ? "" : fallback;
  }

  /** Last assistant reply text in history. Uses reply (real model text) when API provides it. */
  function getLastAssistantText(
    messages: { role?: string; content?: unknown; reply?: string }[]
  ): string {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "assistant") return getMessageText(messages[i]);
    }
    return messages.length ? getMessageText(messages[messages.length - 1]) : "";
  }

  /** True if history has at least one assistant message with non-empty reply (not the abort placeholder). */
  function hasNonEmptyAssistantReply(
    messages: { role?: string; content?: unknown; reply?: string }[]
  ): boolean {
    const text = getLastAssistantText(messages);
    if (!text || text.trim().length === 0) return false;
    if (text.includes("[OpenClaw: Request was aborted.]")) return false;
    return true;
  }

  /** Poll openclaw_history until we get an assistant reply (Ollama can take 35–50s). No-op if !sandboxId. */
  async function waitForOpenClawReply(
    sandboxId: string | undefined,
    opts: { sandboxId?: string; limit?: number } = {},
    timeoutMs = OPENCLAW_REPLY_WAIT_MS
  ): Promise<void> {
    if (!sandboxId) return;
    const historyOpts = { sandboxId, ...opts };
    const deadline = Date.now() + timeoutMs;
    const pollMs = 5000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollMs));
      const historyRes = await executeTool("openclaw_history", historyOpts, undefined);
      const err = (historyRes as { error?: string }).error;
      if (err) continue;
      const raw = (
        historyRes as { messages?: { role?: string; content?: unknown; reply?: string }[] }
      ).messages;
      const messages = Array.isArray(raw) ? raw : [];
      if (hasNonEmptyAssistantReply(messages)) return;
    }
  }

  /** Debug log path for OpenClaw responses (what OpenClaw actually returned). */
  const OPENCLAW_E2E_DEBUG_LOG =
    process.env.OPENCLAW_E2E_DEBUG_LOG || path.join(process.cwd(), "openclaw-e2e-debug.log");

  /** Append OpenClaw response to the debug log so you can see exactly what was returned. */
  function logOpenClawResponse(
    testName: string,
    messages: { role?: string; content?: unknown; reply?: string }[]
  ): void {
    const lastContent = getLastAssistantText(messages);
    const line = `[${new Date().toISOString()}] ${testName} | messages=${messages.length} | lastAssistant=${JSON.stringify(lastContent.slice(0, 500))}${lastContent.length > 500 ? "…" : ""}\n`;
    try {
      fs.appendFileSync(OPENCLAW_E2E_DEBUG_LOG, line);
      // Log full normalized messages (no truncation) so we can see exact content/reply.
      fs.appendFileSync(
        OPENCLAW_E2E_DEBUG_LOG,
        `[${new Date().toISOString()}] ${testName} normalized messages (full)\n${JSON.stringify(messages, null, 2)}\n`,
        "utf8"
      );
    } catch {
      // ignore
    }
    e2eLog.step("openclaw_response", {
      test: testName,
      messageCount: messages.length,
      lastContentPreview: lastContent.slice(0, 120) + (lastContent.length > 120 ? "…" : ""),
    });
  }

  /** Content we use when OpenClaw stored a failed run (e.g. Ollama connection error). */
  const OPENCLAW_ERROR_PREFIX = "[OpenClaw:";

  /** True if content looks like a real Ollama reply; false if it's the error placeholder from a failed run. */
  function isRealOllamaReply(content: string): boolean {
    const t = content.trim();
    return t.length > 0 && !t.startsWith(OPENCLAW_ERROR_PREFIX);
  }

  /**
   * Assert the last assistant message in history is a real reply from Ollama (e2e uses E2E_LLM_MODEL, e.g. qwen3:8b).
   * Fails with a clear message if OpenClaw returned an error placeholder (e.g. container couldn't reach Ollama).
   */
  function expectRealOllamaReply(
    messages: { role?: string; content?: unknown }[],
    hint = "OpenClaw must get a real reply from Ollama (e2e model); check container can reach host Ollama."
  ): string {
    const text = getLastAssistantText(messages);
    expect(
      isRealOllamaReply(text),
      text.startsWith(OPENCLAW_ERROR_PREFIX)
        ? `${hint} Last message was: ${text.slice(0, 80)}...`
        : hint
    ).toBe(true);
    return text;
  }

  /** Helper: send content to OpenClaw via sandboxId and poll openclaw_history until we have at least minMessages and an assistant reply. */
  async function sendAndPollHistory(
    sandboxId: string,
    content: string,
    minMessages: number,
    timeoutMs = OPENCLAW_REPLY_WAIT_MS
  ): Promise<{ role?: string; content?: string; reply?: string }[]> {
    const sendRes = await executeTool("send_to_openclaw", { content, sandboxId }, undefined);
    const err = (sendRes as { error?: string }).error;
    expect(err, `send_to_openclaw must succeed: ${err ?? "no error"}`).toBeUndefined();
    expect((sendRes as { runId?: string }).runId).toBeDefined();
    await waitForOpenClawReply(sandboxId, { sandboxId, limit: 20 }, timeoutMs);
    const historyRes = await executeTool("openclaw_history", { sandboxId, limit: 20 }, undefined);
    const historyErr = (historyRes as { error?: string }).error;
    expect(
      historyErr,
      `openclaw_history must succeed: ${historyErr ?? "no error"}`
    ).toBeUndefined();
    const raw = (historyRes as { messages?: { role?: string; content?: string; reply?: string }[] })
      .messages;
    const messages = Array.isArray(raw) ? raw : [];
    expect(
      messages.length >= minMessages && hasNonEmptyAssistantReply(messages),
      `openclaw_history: expected >= ${minMessages} messages and assistant reply within ${timeoutMs}ms`
    ).toBe(true);
    return messages;
  }

  /** Helper: create one OpenClaw sandbox (same image/env/network as ensureOpenClawGateway), wait for gateway, push to teardown list. */
  async function createOneOpenClawSandbox(): Promise<string | null> {
    const e2eToken = crypto.randomBytes(32).toString("base64url");
    const ollamaBaseUrl = useHostOllama ? openclawOllamaBaseUrl() : openclawOllamaSidecarUrl();
    const createEnv: Record<string, string> = {
      OPENCLAW_E2E_TOKEN: e2eToken,
      OPENCLAW_AGENT_MODEL: `ollama/${E2E_LLM_MODEL}`,
      OPENCLAW_OLLAMA_BASE_URL: ollamaBaseUrl,
    };
    const createPayload: {
      image: string;
      name: string;
      env: Record<string, string>;
      network?: string;
    } = { image: OPENCLAW_IMAGE, name: `e2e-openclaw-${Date.now()}`, env: createEnv };
    if (!useHostOllama) createPayload.network = OPENCLAW_E2E_NETWORK;
    const createRes = await executeTool("create_sandbox", createPayload, undefined);
    const sandboxId = (createRes as { id?: string }).id;
    const status = (createRes as { status?: string }).status;
    if (!sandboxId || status !== "running") return null;
    sandboxIdsForTeardown.push(sandboxId);
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
    if (containerId) {
      const startupDeadline = Date.now() + GATEWAY_STARTUP_WAIT_MS;
      while (Date.now() < startupDeadline) {
        try {
          const logs = execSync(`podman logs ${containerId} 2>&1`, {
            encoding: "utf8",
            timeout: 5000,
          });
          if (/listening on ws:\/\//i.test(logs)) break;
        } catch {
          // retry
        }
        await new Promise((r) => setTimeout(r, GATEWAY_STARTUP_POLL_MS));
      }
      await new Promise((r) => setTimeout(r, 15000));
      try {
        execSync(`podman exec ${containerId} printf ok 2>&1`, { encoding: "utf8", timeout: 10000 });
      } catch {
        return null;
      }
    }
    return sandboxId;
  }

  it("multi-turn: two sends and two replies in session", async () => {
    try {
      const result = await ensureOpenClawGateway();
      expect(result.ok).toBe(true);
      const sandboxId = result.sandboxId!;
      const messages1 = await sendAndPollHistory(
        sandboxId,
        "Say hello in one short sentence.",
        1,
        60_000
      );
      expect(messages1.length).toBeGreaterThanOrEqual(1);
      logOpenClawResponse("multi-turn first", messages1);
      expectRealOllamaReply(messages1, "First reply must be from Ollama.");
      e2eLog.step("multi-turn first reply", { count: messages1.length });
      const messages2 = await sendAndPollHistory(
        sandboxId,
        "Now reply with exactly one word.",
        2,
        60_000
      );
      expect(messages2.length).toBeGreaterThanOrEqual(2);
      logOpenClawResponse("multi-turn second", messages2);
      const lastContent = expectRealOllamaReply(messages2, "Second reply must be from Ollama.");
      expect(lastContent.trim().split(/\s+/).length).toBeLessThanOrEqual(3);
      e2eLog.step("multi-turn second reply", { count: messages2.length });
    } catch (e) {
      await dumpContainerLogs(sandboxIdsForTeardown[0] ?? null);
      throw e;
    }
  }, 120_000);

  it("OpenClaw: agent researches on the internet then OpenClaw replies", async () => {
    try {
      const result = await ensureOpenClawGateway();
      expect(result.ok).toBe(true);
      const sandboxId = result.sandboxId!;
      const createRes = await convPost(
        new Request("http://localhost/api/chat/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "E2E OpenClaw research" }),
        })
      );
      const conv = await createRes.json();
      const conversationId = conv.id as string;
      const prompt = `Use web_search to look up a simple fact (e.g. "capital of France" or "current year"). Then use send_to_openclaw with sandboxId "${sandboxId}" and content "Say in one short sentence: what is the capital of France?" Then use openclaw_history with sandboxId "${sandboxId}" to get the reply.`;
      const res = await chatPost(
        new Request("http://localhost/api/chat?stream=1", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({
            message: prompt,
            conversationId,
            providerId: E2E_LLM_CONFIG_ID,
            useHeapMode: true,
          }),
        })
      );
      expect(res?.status).toBe(202);
      const data = await res!.json();
      const events = await readEventStream(data.turnId);
      const doneEvent = events.find((e) => e?.type === "done");
      expect(doneEvent).toBeDefined();
      const toolResults =
        (doneEvent as { toolResults?: { name: string; result?: unknown }[] } | undefined)
          ?.toolResults ?? [];
      const names = toolResults.map((r) => r.name);
      expect(
        names.includes("web_search") || names.includes("fetch_url"),
        "agent should call web_search or fetch_url for research"
      ).toBe(true);
      expect(names.includes("send_to_openclaw"), "agent should call send_to_openclaw").toBe(true);
      let messages: { role?: string; content?: unknown; reply?: string }[] = [];
      const historyResult = toolResults.find((r) => r.name === "openclaw_history")?.result as
        | { messages?: { role?: string; content?: unknown; reply?: string }[] }
        | undefined;
      if (historyResult?.messages) messages = historyResult.messages;
      if (messages.length < 1 || !hasNonEmptyAssistantReply(messages)) {
        await waitForOpenClawReply(sandboxId, { sandboxId, limit: 20 });
        const directHistory = await executeTool(
          "openclaw_history",
          { sandboxId, limit: 20 },
          undefined
        );
        const err = (directHistory as { error?: string }).error;
        expect(err, `openclaw_history must succeed, got: ${err ?? "no error"}`).toBeUndefined();
        messages =
          (directHistory as { messages?: { role?: string; content?: unknown; reply?: string }[] })
            .messages ?? [];
      }
      expect(messages.length).toBeGreaterThanOrEqual(1);
      logOpenClawResponse("research", messages);
      expectRealOllamaReply(messages, "After research, OpenClaw must return a real reply.");
      e2eLog.step("research then OpenClaw", {
        toolNames: names.join(","),
        messageCount: messages.length,
      });
    } catch (e) {
      await dumpContainerLogs(sandboxIdsForTeardown[0] ?? null);
      throw e;
    }
  }, 120_000);

  it("OpenClaw interleaved with other tools in one turn", async () => {
    try {
      const result = await ensureOpenClawGateway();
      expect(result.ok).toBe(true);
      const sandboxId = result.sandboxId!;
      const createRes = await convPost(
        new Request("http://localhost/api/chat/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "E2E OpenClaw interleaved" }),
        })
      );
      const conv = await createRes.json();
      const conversationId = conv.id as string;
      const prompt = `First call web_search with a short query (e.g. "capital of France"). Then call send_to_openclaw with sandboxId "${sandboxId}" and content "Say the word interleaved." Then call openclaw_history with sandboxId "${sandboxId}" to get the reply.`;
      const res = await chatPost(
        new Request("http://localhost/api/chat?stream=1", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({
            message: prompt,
            conversationId,
            providerId: E2E_LLM_CONFIG_ID,
            useHeapMode: true,
          }),
        })
      );
      expect(res?.status).toBe(202);
      const data = await res!.json();
      const events = await readEventStream(data.turnId);
      const doneEvent = events.find((e) => e?.type === "done");
      expect(doneEvent).toBeDefined();
      const toolResults =
        (doneEvent as { toolResults?: { name: string; result?: unknown }[] } | undefined)
          ?.toolResults ?? [];
      const names = toolResults.map((r) => r.name);
      expect(
        names.some(
          (n) =>
            n === "send_to_openclaw" &&
            (names.includes("web_search") || names.includes("fetch_url"))
        ),
        "agent should call web_search or fetch_url and send_to_openclaw"
      ).toBe(true);
      const sendResult = toolResults.find((r) => r.name === "send_to_openclaw")?.result as
        | { error?: string }
        | undefined;
      if (sendResult) expect(sendResult.error).toBeUndefined();
      let messages: { content?: unknown }[] = [];
      const historyResult = toolResults.find((r) => r.name === "openclaw_history")?.result as
        | { messages?: { content?: unknown }[] }
        | undefined;
      if (historyResult?.messages) messages = historyResult.messages;
      if (messages.length < 1) {
        const directHistory = await executeTool(
          "openclaw_history",
          { sandboxId, limit: 10 },
          undefined
        );
        const err = (directHistory as { error?: string }).error;
        expect(err, `openclaw_history must succeed, got: ${err ?? "no error"}`).toBeUndefined();
        messages = (directHistory as { messages?: { content?: unknown }[] }).messages ?? [];
      }
      expect(messages.length).toBeGreaterThanOrEqual(1);
      logOpenClawResponse("interleaved", messages);
      expectRealOllamaReply(messages, "Interleaved turn must get a real Ollama reply.");
      e2eLog.step("interleaved turn", {
        toolNames: names.join(","),
        messageCount: messages.length,
      });
    } catch (e) {
      await dumpContainerLogs(sandboxIdsForTeardown[0] ?? null);
      throw e;
    }
  }, 120_000);

  it("two sandboxes: communicate with each other (A says something, B replies to A)", async () => {
    try {
      const result = await ensureOpenClawGateway();
      expect(result.ok).toBe(true);
      const sandboxA = result.sandboxId!;
      const sandboxB = await createOneOpenClawSandbox();
      expect(sandboxB).not.toBeNull();
      const messagesA = await sendAndPollHistory(sandboxA, "Say the word alpha.", 1, 60_000);
      expect(messagesA.length).toBeGreaterThanOrEqual(1);
      logOpenClawResponse("two sandboxes A", messagesA);
      const textA = expectRealOllamaReply(
        messagesA,
        "Sandbox A must get real Ollama reply."
      ).trim();
      expect(textA.toLowerCase()).toContain("alpha");
      const messageToB = `The other OpenClaw instance said: "${textA.slice(0, 200)}". Reply with exactly: I received it.`;
      const messagesB = await sendAndPollHistory(sandboxB!, messageToB, 1, 60_000);
      expect(messagesB.length).toBeGreaterThanOrEqual(1);
      logOpenClawResponse("two sandboxes B", messagesB);
      const textB = expectRealOllamaReply(
        messagesB,
        "Sandbox B must get real Ollama reply."
      ).toLowerCase();
      expect(textB).toContain("received");
      e2eLog.step("two sandboxes", {
        sandboxA,
        sandboxB,
        textASnippet: textA.slice(0, 30),
        textBSnippet: textB.slice(0, 30),
      });
    } catch (e) {
      await dumpContainerLogs(sandboxIdsForTeardown[0] ?? null);
      throw e;
    }
  }, 180_000);

  it("abort then send again in same sandbox", async () => {
    try {
      const result = await ensureOpenClawGateway();
      expect(result.ok).toBe(true);
      const sandboxId = result.sandboxId!;
      await sendAndPollHistory(sandboxId, "Say hello.", 1, 60_000);
      const abortRes = await executeTool("openclaw_abort", { sandboxId }, undefined);
      expect((abortRes as { error?: string }).error).toBeUndefined();
      e2eLog.step("abort done", {});
      const messagesAfter = await sendAndPollHistory(
        sandboxId,
        "Say the word continued.",
        1,
        60_000
      );
      expect(messagesAfter.length).toBeGreaterThanOrEqual(1);
      logOpenClawResponse("abort then send", messagesAfter);
      const last = expectRealOllamaReply(
        messagesAfter,
        "After abort, send must get real Ollama reply."
      ).toLowerCase();
      expect(last).toContain("continued");
      e2eLog.step("send after abort", { count: messagesAfter.length });
    } catch (e) {
      await dumpContainerLogs(sandboxIdsForTeardown[0] ?? null);
      throw e;
    }
  }, 120_000);

  it("structured reply: content constraint", async () => {
    try {
      const result = await ensureOpenClawGateway();
      expect(result.ok).toBe(true);
      const sandboxId = result.sandboxId!;
      const messages = await sendAndPollHistory(
        sandboxId,
        "Reply with only the three letters A, B and C in that order, nothing else.",
        1,
        60_000
      );
      expect(messages.length).toBeGreaterThanOrEqual(1);
      logOpenClawResponse("structured reply", messages);
      const last = expectRealOllamaReply(
        messages,
        "Structured reply must come from Ollama."
      ).toUpperCase();
      expect(last).toMatch(/A.*B.*C|ABC/);
      e2eLog.step("structured reply", { lastSnippet: last.slice(0, 20) });
    } catch (e) {
      await dumpContainerLogs(sandboxIdsForTeardown[0] ?? null);
      throw e;
    }
  }, 120_000);

  it("full infra: chat creates agent + workflow, run uses OpenClaw", async () => {
    const result = await ensureOpenClawGateway();
    expect(result.ok).toBe(true);
    const sandboxId = result.sandboxId;
    if (!sandboxId) {
      e2eLog.step("skip: need container sandbox for full-infra test", {});
      return;
    }
    const createRes = await convPost(
      new Request("http://localhost/api/chat/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "E2E OpenClaw full infra" }),
      })
    );
    const conv = await createRes.json();
    const conversationId = conv.id as string;
    expect(typeof conversationId).toBe("string");
    const message = `Create an agent that has the tools send_to_openclaw and openclaw_history. The agent must use sandboxId "${sandboxId}" when calling those tools. Set the agent's system prompt so that when it receives a message it calls send_to_openclaw with that content and sandboxId "${sandboxId}", then openclaw_history with sandboxId "${sandboxId}" to get the reply. Then create a workflow with one node that runs this agent, and run the workflow. The workflow input should be: "Say hello in one short sentence."`;
    const res = await chatPost(
      new Request("http://localhost/api/chat?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          message,
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
    e2eLog.toolCall("full_infra_turn", names.join(","));
    expect(names).toContain("create_agent");
    expect(names).toContain("create_workflow");
    expect(names).toContain("update_workflow");
    expect(names).toContain("execute_workflow");
    const execResult = toolResults.find((r) => r.name === "execute_workflow")?.result as
      | { runId?: string; output?: { output?: unknown; trail?: unknown[] }; error?: string }
      | undefined;
    expect(execResult).toBeDefined();
    expect(execResult?.error).toBeUndefined();
    expect(execResult?.runId).toBeDefined();
    const output = execResult?.output;
    const trail = Array.isArray(output?.trail) ? output.trail : [];
    const outputText =
      output && typeof output === "object" && output.output != null
        ? typeof (output as { output?: string }).output === "string"
          ? (output as { output: string }).output
          : JSON.stringify(output.output)
        : "";
    const trailText = trail
      .map((s: unknown) => {
        const step = s as { output?: unknown };
        return typeof step?.output === "string" ? step.output : JSON.stringify(step?.output ?? "");
      })
      .join(" ");
    const hasOpenClawEvidence =
      /hello|hi|hey|greeting/i.test(outputText) ||
      /hello|hi|hey|greeting/i.test(trailText) ||
      trail.some((s: unknown) => {
        const step = s as { nodeId?: string; output?: unknown };
        return step?.output != null && String(step.output).length > 0;
      });
    expect(hasOpenClawEvidence).toBe(true);
    e2eLog.step("full infra run completed", {
      runId: execResult?.runId,
      trailSteps: trail.length,
      outputSnippet: outputText.slice(0, 100),
    });
  }, 300_000);
});
