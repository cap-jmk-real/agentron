/**
 * OpenClaw Gateway WebSocket client using the official protocol.
 *
 * Protocol from openclaw/openclaw src/gateway: ConnectParams schema (frames.ts), client ids (client-info.ts).
 * - client.id must be one of GATEWAY_CLIENT_IDS (e.g. gateway-client, openclaw-control-ui).
 * - client.mode must be one of GATEWAY_CLIENT_MODES (webchat, cli, ui, backend, node, probe, test).
 * - device is optional; omit when no valid signature (schema requires NonEmptyString for device fields).
 * - Gateway may send connect.challenge first; client then sends connect. Official client also sends connect after 750ms.
 */

import WebSocket from "ws";

const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789";
const PROTOCOL_VERSION = 3;
const CONNECT_TIMEOUT_MS = 8000;
const RPC_TIMEOUT_MS = 60000;
const DEFAULT_SESSION_KEY = "default";
/** Delay before sending connect when no connect.challenge received (matches official client queueConnect). */
const CONNECT_DELAY_MS = 750;

/** Allowed by OpenClaw gateway schema (src/gateway/protocol/schema/primitives.ts, client-info.ts). */
const OPENCLAW_CLIENT_ID = "gateway-client";
const OPENCLAW_CLIENT_MODE = "backend";

function getGatewayUrl(): string {
  return (
    (typeof process !== "undefined" && process.env?.OPENCLAW_GATEWAY_URL) || DEFAULT_GATEWAY_URL
  );
}

function getGatewayToken(): string | undefined {
  return typeof process !== "undefined" ? process.env?.OPENCLAW_GATEWAY_TOKEN : undefined;
}

/** Origin header for WebSocket (gateway origin-check expects it; Node ws does not send it by default). */
function originForUrl(wsUrl: string): string {
  try {
    const u = new URL(wsUrl);
    return `${u.protocol === "wss:" ? "https" : "http"}://${u.host}`;
  } catch {
    return "http://127.0.0.1";
  }
}

type ResFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code?: string; message?: string };
};
type EventFrame = { type: "event"; event: string; payload?: unknown };

/** Build connect params matching OpenClaw ConnectParamsSchema. Omit device (no valid signature). */
function buildConnectParams(token: string | undefined): Record<string, unknown> {
  const connectParams: Record<string, unknown> = {
    minProtocol: PROTOCOL_VERSION,
    maxProtocol: PROTOCOL_VERSION,
    client: {
      id: OPENCLAW_CLIENT_ID,
      version: "0.1",
      platform: typeof process !== "undefined" ? process.platform : "node",
      mode: OPENCLAW_CLIENT_MODE,
    },
    role: "operator",
    scopes: ["operator.read", "operator.write", "operator.admin", "operator.approvals", "operator.pairing"],
    caps: [],
    commands: [],
    permissions: {},
    locale: "en-US",
    userAgent: "agentron-studio/0.1",
  };
  if (token) connectParams.auth = { token };
  return connectParams;
}

/** Open WebSocket, wait for connect.challenge, send connect then one RPC, wait for response, then close. */
export async function openclawRpc<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  options?: { url?: string; token?: string; timeoutMs?: number }
): Promise<T> {
  const url = options?.url ?? getGatewayUrl();
  const token = options?.token ?? getGatewayToken();
  const timeoutMs = options?.timeoutMs ?? RPC_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, {
      handshakeTimeout: CONNECT_TIMEOUT_MS,
      headers: { Origin: originForUrl(url) },
    });
    const reqId = `agentron-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const connectId = `agentron-connect-${Date.now()}`;
    let resolved = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let connectSent = false;
    const sendConnectAndRpc = () => {
      if (connectSent || ws.readyState !== WebSocket.OPEN) return;
      connectSent = true;
      const connectParams = buildConnectParams(token);
      ws.send(
        JSON.stringify({ type: "req", id: connectId, method: "connect", params: connectParams })
      );
      ws.send(JSON.stringify({ type: "req", id: reqId, method, params }));
    };

    const cleanup = () => {
      try {
        if (timeoutId != null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        ws.removeAllListeners();
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
          ws.terminate();
      } catch {
        // ignore
      }
    };

    const done = (value: T) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(value);
    };

    const fail = (err: Error) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      reject(err);
    };

    timeoutId = setTimeout(() => {
      fail(new Error(`OpenClaw RPC timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    ws.on("open", () => {
      setTimeout(sendConnectAndRpc, CONNECT_DELAY_MS);
    });
    ws.on("error", (err) => fail(err instanceof Error ? err : new Error(String(err))));
    ws.on("close", (code, reason) => {
      if (!resolved)
        fail(new Error(`OpenClaw WebSocket closed: ${code} ${reason?.toString() || ""}`));
    });

    ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const raw = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
        const msg = JSON.parse(raw) as ResFrame | EventFrame;

        if ((msg as EventFrame).type === "event" && (msg as EventFrame).event === "connect.challenge") {
          if (!connectSent) sendConnectAndRpc();
          return;
        }

        if ((msg as ResFrame).type === "res") {
          const res = msg as ResFrame;
          if (res.id === connectId) {
            if (!res.ok) {
              const errMsg = res.error?.message ?? (res.payload as string) ?? "Connect failed";
              fail(new Error(errMsg));
              return;
            }
            return;
          }
          if (res.id === reqId) {
            if (timeoutId != null) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
            if (!res.ok) {
              fail(new Error(res.error?.message ?? "RPC error"));
              return;
            }
            done((res.payload ?? null) as T);
          }
        }
      } catch {
        // ignore parse errors
      }
    });
  });
}

/** Check if the OpenClaw Gateway is reachable. Sends connect on connect.challenge or after CONNECT_DELAY_MS. */
export async function openclawHealth(options?: {
  url?: string;
  token?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const url = options?.url ?? getGatewayUrl();
  const token = options?.token ?? getGatewayToken();
  return new Promise((resolve) => {
    const ws = new WebSocket(url, {
      handshakeTimeout: 5000,
      headers: { Origin: originForUrl(url) },
    });
    const connectId = `agentron-connect-${Date.now()}`;
    let connectSent = false;
    const sendConnect = () => {
      if (connectSent || ws.readyState !== WebSocket.OPEN) return;
      connectSent = true;
      const connectParams = buildConnectParams(token);
      ws.send(
        JSON.stringify({ type: "req", id: connectId, method: "connect", params: connectParams })
      );
    };

    const timeout = setTimeout(() => {
      try {
        ws.terminate();
      } catch {
        // ignore
      }
      resolve({ ok: false, error: "Health check timeout" });
    }, 8000);

    const finish = (ok: boolean, error?: string) => {
      clearTimeout(timeout);
      try {
        ws.close(1000);
      } catch {
        // ignore
      }
      resolve({ ok, error });
    };

    ws.on("open", () => {
      setTimeout(sendConnect, CONNECT_DELAY_MS);
    });
    ws.on("error", (err) => {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : String(err);
      resolve({ ok: false, error: msg });
    });
    ws.on("close", (code, reason) => {
      clearTimeout(timeout);
      if (code === 1000) return;
      const reasonStr = typeof reason === "string" ? reason : reason?.toString() ?? "";
      const detail =
        reasonStr || code === 1006
          ? `WebSocket closed: code=${code}${reasonStr ? ` reason=${reasonStr}` : ""}`
          : `WebSocket closed: code=${code} (see podman logs for gateway reason)`;
      resolve({ ok: false, error: detail });
    });
    ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const raw = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
        const msg = JSON.parse(raw) as ResFrame | EventFrame;
        if ((msg as EventFrame).type === "event" && (msg as EventFrame).event === "connect.challenge") {
          if (!connectSent) sendConnect();
          return;
        }
        if ((msg as ResFrame).type === "res" && (msg as ResFrame).id === connectId) {
          const res = msg as ResFrame;
          finish(res.ok, res.ok ? undefined : res.error?.message ?? "Connect failed");
        }
      } catch {
        // ignore parse errors
      }
    });
  });
}

/** Send a message to OpenClaw (chat.send). Schema requires sessionKey, message, idempotencyKey. Returns runId and status. */
export async function openclawSend(
  content: string,
  options?: { url?: string; token?: string; sessionKey?: string; waitForResponseMs?: number }
): Promise<{ runId?: string; status?: string; message?: string; response?: string }> {
  const sessionKey = options?.sessionKey ?? DEFAULT_SESSION_KEY;
  const idempotencyKey = `agentron-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const params: Record<string, unknown> = {
    sessionKey,
    message: content,
    idempotencyKey,
  };
  const result = await openclawRpc<{ runId?: string; status?: string }>("chat.send", params, {
    url: options?.url,
    token: options?.token,
    timeoutMs: options?.waitForResponseMs ?? 15000,
  });
  return result as { runId?: string; status?: string; message?: string; response?: string };
}

/** Get chat history (chat.history). Schema requires sessionKey. */
export async function openclawHistory(options?: {
  url?: string;
  token?: string;
  sessionKey?: string;
  limit?: number;
}): Promise<{ messages?: Array<{ role?: string; content?: string }>; error?: string }> {
  const sessionKey = options?.sessionKey ?? DEFAULT_SESSION_KEY;
  const params: Record<string, unknown> = { sessionKey };
  if (options?.limit != null && options.limit > 0) params.limit = Math.min(options.limit, 1000);
  try {
    const result = await openclawRpc<{ messages?: Array<{ role?: string; content?: string }> }>(
      "chat.history",
      params,
      options
    );
    return result ?? {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Abort current OpenClaw run (chat.abort). Schema requires sessionKey. */
export async function openclawAbort(options?: {
  url?: string;
  token?: string;
  sessionKey?: string;
  runId?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const sessionKey = options?.sessionKey ?? DEFAULT_SESSION_KEY;
  const params: Record<string, unknown> = { sessionKey };
  if (options?.runId) params.runId = options.runId;
  try {
    await openclawRpc("chat.abort", params, options);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Get Gateway status. */
export async function openclawStatus(options?: {
  url?: string;
  token?: string;
}): Promise<Record<string, unknown>> {
  try {
    const result = await openclawRpc<Record<string, unknown>>(
      "status",
      {},
      { ...options, timeoutMs: 10000 }
    );
    return result ?? {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), ok: false };
  }
}
