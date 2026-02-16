/**
 * OpenClaw Gateway WebSocket client using the official protocol.
 *
 * Protocol (from https://docs.clawd.bot/gateway/protocol and OpenClaw source):
 * - Framing: Request { type: "req", id, method, params }, Response { type: "res", id, ok, payload | error }, Event { type: "event", event, payload }
 * - First frame must be connect: method "connect", params: minProtocol, maxProtocol, client, role, scopes, auth, device (optional for local)
 * - chat.send params: sessionKey, message, idempotencyKey (all required per schema); response streams via "chat" events
 * - chat.history params: sessionKey (required), limit optional
 * - chat.abort params: sessionKey (required), runId optional
 */

import WebSocket from "ws";

const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789";
const PROTOCOL_VERSION = 3;
const CONNECT_TIMEOUT_MS = 8000;
const RPC_TIMEOUT_MS = 60000;
const DEFAULT_SESSION_KEY = "default";

function getGatewayUrl(): string {
  return (typeof process !== "undefined" && process.env?.OPENCLAW_GATEWAY_URL) || DEFAULT_GATEWAY_URL;
}

function getGatewayToken(): string | undefined {
  return typeof process !== "undefined" ? process.env?.OPENCLAW_GATEWAY_TOKEN : undefined;
}

type ResFrame = { type: "res"; id: string; ok: boolean; payload?: unknown; error?: { code?: string; message?: string } };
type EventFrame = { type: "event"; event: string; payload?: unknown };

/** Open WebSocket, perform connect handshake, send one RPC, wait for response, then close. */
export async function openclawRpc<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  options?: { url?: string; token?: string; timeoutMs?: number }
): Promise<T> {
  const url = options?.url ?? getGatewayUrl();
  const token = options?.token ?? getGatewayToken();
  const timeoutMs = options?.timeoutMs ?? RPC_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { handshakeTimeout: CONNECT_TIMEOUT_MS });
    const reqId = `agentron-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const connectId = `agentron-connect-${Date.now()}`;
    let resolved = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      try {
        if (timeoutId != null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        ws.removeAllListeners();
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.terminate();
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

    ws.on("error", (err) => fail(err instanceof Error ? err : new Error(String(err))));
    ws.on("close", (code, reason) => {
      if (!resolved) fail(new Error(`OpenClaw WebSocket closed: ${code} ${reason?.toString() || ""}`));
    });

    let connectDone = false;

    ws.on("open", () => {
      try {
        // First frame must be connect (Gateway protocol)
        const connectParams: Record<string, unknown> = {
          minProtocol: PROTOCOL_VERSION,
          maxProtocol: PROTOCOL_VERSION,
          client: {
            id: "agentron",
            version: "0.1",
            platform: "node",
            mode: "operator",
          },
          role: "operator",
          scopes: ["operator.read", "operator.write"],
          caps: [],
          commands: [],
          permissions: {},
          locale: "en-US",
          userAgent: "agentron-studio/0.1",
        };
        if (token) connectParams.auth = { token };
        // Omit device for local/token auth; gateway may require device (with signature) for remote pairing

        ws.send(JSON.stringify({ type: "req", id: connectId, method: "connect", params: connectParams }));
        // Then send the actual RPC
        ws.send(JSON.stringify({ type: "req", id: reqId, method, params }));
      } catch (e) {
        fail(e instanceof Error ? e : new Error(String(e)));
      }
    });

    ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const raw = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
        const msg = JSON.parse(raw) as ResFrame | EventFrame;

        if (msg.type === "res") {
          const res = msg as ResFrame;
          if (res.id === connectId) {
            if (!res.ok) {
              const errMsg = res.error?.message ?? res.payload as string ?? "Connect failed";
              fail(new Error(errMsg));
              return;
            }
            connectDone = true;
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
        // Events (e.g. chat stream) are type "event"; we only need the req response for this helper
      } catch {
        // ignore parse errors
      }
    });
  });
}

/** Check if the OpenClaw Gateway is reachable (status RPC over WebSocket). */
export async function openclawHealth(options?: { url?: string; token?: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    await openclawRpc("status", {}, { ...options, timeoutMs: 5000 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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
    const result = await openclawRpc<{ messages?: Array<{ role?: string; content?: string }> }>("chat.history", params, options);
    return result ?? {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Abort current OpenClaw run (chat.abort). Schema requires sessionKey. */
export async function openclawAbort(options?: { url?: string; token?: string; sessionKey?: string; runId?: string }): Promise<{ ok: boolean; error?: string }> {
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
export async function openclawStatus(options?: { url?: string; token?: string }): Promise<Record<string, unknown>> {
  try {
    const result = await openclawRpc<Record<string, unknown>>("status", {}, { ...options, timeoutMs: 10000 });
    return result ?? {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), ok: false };
  }
}
