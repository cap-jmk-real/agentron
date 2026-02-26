/**
 * Tool handlers for OpenClaw: send_to_openclaw, openclaw_history, openclaw_abort.
 */
import type { ExecuteToolContext } from "./execute-tool-shared";
import path from "node:path";
import fs from "node:fs";
import { db, sandboxes, fromSandboxRow } from "../../_lib/db";
import { getContainerManager } from "../../_lib/container-manager";
import { getStoredCredential } from "../../_lib/credential-store";
import { openclawSend, openclawHistory, openclawAbort } from "../../_lib/openclaw-client";
import { runOpenclawRpcInContainer } from "../../_lib/openclaw-in-container";
import { eq } from "drizzle-orm";

export const OPENCLAW_TOOL_NAMES = [
  "send_to_openclaw",
  "openclaw_history",
  "openclaw_abort",
] as const;

/** Normalize one OpenClaw chat.history message. content = full string (text + thinking, exclude toolCall). reply = only type "text" parts for assertions. See docs.openclaw.ai/concepts/messages, openclaw repo src/gateway/server-methods/chat.ts. */
function normalizeOpenClawHistoryMessage(msg: Record<string, unknown>): {
  role: string;
  content: string;
  reply?: string;
} {
  const visit = (v: unknown): string => {
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return v.map(visit).join("");
    if (typeof v === "object" && v !== null) {
      const o = v as Record<string, unknown>;
      if (typeof o.text === "string") return o.text;
      if (typeof o.content === "string") return o.content;
      if (typeof o.value === "string") return o.value;
      if (typeof (o as { thinking?: string }).thinking === "string")
        return (o as { thinking: string }).thinking;
      return Object.values(o).map(visit).join("");
    }
    return "";
  };
  const r = msg.role as string | undefined;
  const role =
    r === "model" || r === "assistant" ? "assistant" : r === "user" ? "user" : (r ?? "user");
  let content = "";
  let reply = "";
  const c = msg.content ?? msg.body ?? msg.text;
  if (typeof c === "string") {
    content = c;
    reply = c;
  } else if (Array.isArray(c)) {
    const parts = c as Record<string, unknown>[];
    const contentBits = parts
      .map((x) => {
        if (typeof x === "string") return x;
        if (typeof x !== "object" || x === null) return "";
        const part = x as Record<string, unknown>;
        const type = typeof part.type === "string" ? part.type : "";
        if (type === "toolCall") return "";
        if (typeof part.text === "string") return part.text;
        if (typeof (part as { thinking?: string }).thinking === "string")
          return (part as { thinking: string }).thinking;
        if (typeof part.content === "string") return part.content;
        if (typeof part.value === "string") return part.value;
        return visit(x);
      })
      .filter(Boolean);
    content = contentBits.join("");
    const replyParts = parts
      .filter((x) => {
        if (typeof x !== "object" || x === null) return false;
        const part = x as Record<string, unknown>;
        const type = typeof part.type === "string" ? part.type : "";
        if (type === "toolCall") return false;
        return typeof part.text === "string";
      })
      .map((x) => (x as { text: string }).text);
    reply = replyParts.join("");
    if (reply === "") {
      const toolCallTexts = parts
        .filter((x) => {
          if (typeof x !== "object" || x === null) return false;
          const part = x as Record<string, unknown>;
          if ((typeof part.type === "string" ? part.type : "") !== "toolCall") return false;
          const name = typeof part.name === "string" ? part.name : "";
          if (name !== "tts") return false;
          const args = part.arguments;
          return (
            typeof args === "object" &&
            args !== null &&
            typeof (args as { text?: string }).text === "string" &&
            ((args as { text: string }).text as string).trim().length > 0
          );
        })
        .map((x) => {
          const args = (x as { arguments?: { text?: string } }).arguments;
          return args?.text?.trim() ?? "";
        })
        .filter(Boolean);
      if (toolCallTexts.length > 0) reply = toolCallTexts.join(" ");
    }
    if (reply === "" && content.length > 0) reply = content;
    if (content === "")
      content = c
        .map((x) => {
          if (typeof x === "string") return x;
          if (typeof x !== "object" || x === null) return "";
          const part = x as Record<string, unknown>;
          if (typeof part.text === "string") return part.text;
          if (typeof part.content === "string") return part.content;
          if (typeof part.value === "string") return part.value;
          return visit(x);
        })
        .join("");
  } else if (typeof c === "object" && c !== null) {
    const o = c as Record<string, unknown>;
    if (Array.isArray(o.parts)) {
      const partList = o.parts as Record<string, unknown>[];
      content = partList
        .map((p) =>
          typeof p?.text === "string"
            ? p.text
            : typeof (p as { thinking?: string })?.thinking === "string"
              ? (p as { thinking: string }).thinking
              : typeof p?.content === "string"
                ? p.content
                : ""
        )
        .join("");
      reply = partList
        .filter(
          (p) =>
            (typeof p?.type === "string" ? p.type : "") !== "toolCall" &&
            typeof p?.text === "string"
        )
        .map((p) => (typeof p?.text === "string" ? p.text : ""))
        .join("");
      if (reply === "") {
        const ttsTexts = partList
          .filter(
            (p) =>
              (typeof p?.type === "string" ? p.type : "") === "toolCall" &&
              (typeof p?.name === "string" ? p.name : "") === "tts" &&
              typeof (p as { arguments?: { text?: string } })?.arguments?.text === "string" &&
              ((p as { arguments: { text: string } }).arguments.text as string).trim().length > 0
          )
          .map((p) => ((p as { arguments: { text: string } }).arguments.text as string).trim());
        if (ttsTexts.length > 0) reply = ttsTexts.join(" ");
      }
      if (reply === "" && content.length > 0) reply = content;
    } else if (typeof (o as { text?: string }).text === "string") {
      content = (o as { text: string }).text;
      reply = content;
    } else if (typeof (o as { content?: string }).content === "string") {
      content = (o as { content: string }).content;
      reply = content;
    }
  }
  if (content === "" && Array.isArray(msg.parts))
    content = (msg.parts as Record<string, unknown>[])
      .map((p) =>
        typeof p?.text === "string"
          ? p.text
          : typeof p?.content === "string"
            ? p.content
            : typeof p?.value === "string"
              ? p.value
              : ""
      )
      .join("");
  if (content === "" && typeof msg === "object" && msg !== null) {
    const obj = msg as Record<string, unknown>;
    for (const k of ["message", "body", "raw", "value"]) {
      if (typeof obj[k] === "string" && (obj[k] as string).trim().length > 0) {
        content = obj[k] as string;
        if (reply === "") reply = content;
        break;
      }
    }
  }
  if ((content === "" || content === "[object Object]") && typeof c === "object" && c !== null) {
    content = visit(c).trim();
    if (reply === "") reply = content;
  }
  if (content === "" && typeof msg.errorMessage === "string" && msg.errorMessage.trim()) {
    content = `[OpenClaw: ${msg.errorMessage.trim()}]`;
    reply = content;
  }
  return { role, content, reply };
}

export async function handleOpenClawTools(
  name: string,
  a: Record<string, unknown>,
  ctx: ExecuteToolContext | undefined
): Promise<unknown> {
  const vaultKey = ctx?.vaultKey ?? null;

  switch (name) {
    case "send_to_openclaw": {
      const content =
        (typeof a.content === "string" && a.content.trim()) ||
        (typeof a.message === "string" && a.message.trim()) ||
        (typeof (a as { text?: string }).text === "string" &&
          (a as { text?: string }).text?.trim()) ||
        (() => {
          for (const v of Object.values(a)) {
            if (typeof v === "string" && v.trim() && !v.startsWith("ws://")) return v.trim();
          }
          return "";
        })();
      if (!content) return { error: "content is required" };
      const sandboxId = (a.sandboxId as string)?.trim();
      if (sandboxId) {
        const rows = await db.select().from(sandboxes).where(eq(sandboxes.id, sandboxId));
        if (rows.length === 0) return { error: "Sandbox not found" };
        const sb = fromSandboxRow(rows[0]);
        if (!sb.containerId) return { error: "Sandbox has no container" };
        if (!sb.image?.toLowerCase().includes("openclaw"))
          return { error: "Sandbox is not an OpenClaw container" };
        const podman = getContainerManager();
        const { payload, error } = await runOpenclawRpcInContainer(
          sb.containerId,
          "chat.send",
          {
            sessionKey: "default",
            message: content,
            idempotencyKey: `agentron-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          },
          (cid, cmd) => podman.exec(cid, cmd)
        );
        if (error) {
          const hint =
            error.includes("running containers") || error.includes("container state")
              ? " Container may have stopped or exec failed. Check container logs."
              : " Make sure the OpenClaw Gateway is running in the container (e.g. create_sandbox with OpenClaw image).";
          return {
            error: `OpenClaw: ${error}`,
            message: hint.trim(),
          };
        }
        const result = payload as { runId?: string; status?: string };
        return {
          ...result,
          message: result?.runId ? "Message sent to OpenClaw." : (result?.status ?? "Sent."),
        };
      }
      const gatewayUrl =
        typeof a.gatewayUrl === "string" ? (a.gatewayUrl as string).trim() : undefined;
      let url = gatewayUrl;
      let token: string | undefined;
      if (vaultKey) {
        const vaultUrl = await getStoredCredential("openclaw_gateway_url", vaultKey);
        const vaultToken = await getStoredCredential("openclaw_gateway_token", vaultKey);
        if (!url && vaultUrl) url = vaultUrl;
        if (vaultToken) token = vaultToken;
      }
      try {
        const result = await openclawSend(content, { url, token });
        return {
          ...result,
          message: result.runId ? "Message sent to OpenClaw." : (result.message ?? "Sent."),
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          error: `OpenClaw: ${msg}`,
          message:
            "Make sure the OpenClaw Gateway is running (e.g. openclaw gateway) and OPENCLAW_GATEWAY_URL/OPENCLAW_GATEWAY_TOKEN are set if needed.",
        };
      }
    }
    case "openclaw_history": {
      const sandboxIdHist = (a.sandboxId as string)?.trim();
      if (sandboxIdHist) {
        const rows = await db.select().from(sandboxes).where(eq(sandboxes.id, sandboxIdHist));
        if (rows.length === 0) return { error: "Sandbox not found", messages: [] };
        const sb = fromSandboxRow(rows[0]);
        if (!sb.containerId) return { error: "Sandbox has no container", messages: [] };
        if (!sb.image?.toLowerCase().includes("openclaw"))
          return { error: "Sandbox is not an OpenClaw container", messages: [] };
        const limit = typeof a.limit === "number" && a.limit > 0 ? Math.min(a.limit, 50) : 20;
        const podman = getContainerManager();
        const { payload, error } = await runOpenclawRpcInContainer(
          sb.containerId,
          "chat.history",
          { sessionKey: "default", limit },
          (cid, cmd) => podman.exec(cid, cmd)
        );
        if (error) return { error: `OpenClaw: ${error}`, messages: [] };
        const raw = payload as
          | {
              messages?: unknown[];
              history?: unknown[];
              transcript?: unknown[];
              data?: unknown[];
              result?: unknown[];
            }
          | unknown[];
        const rawMessages = Array.isArray(raw)
          ? raw
          : raw && typeof raw === "object"
            ? ((raw as { messages?: unknown[] }).messages ??
              (raw as { history?: unknown[] }).history ??
              (raw as { transcript?: unknown[] }).transcript ??
              (raw as { data?: unknown[] }).data ??
              (raw as { result?: unknown[] }).result ??
              [])
            : [];
        const arr = Array.isArray(rawMessages) ? rawMessages : [];
        if (process.env.OPENCLAW_E2E === "1") {
          const rawLogPath =
            process.env.OPENCLAW_E2E_RAW_LOG ||
            path.join(process.cwd(), "openclaw-e2e-raw-messages.log");
          try {
            const block = `\n[${new Date().toISOString()}] openclaw_history raw (${arr.length} messages)\n${JSON.stringify(arr, null, 2)}\n`;
            fs.appendFileSync(rawLogPath, block, "utf8");
          } catch {
            // ignore
          }
        }
        const messages = arr.map((m) =>
          normalizeOpenClawHistoryMessage(
            typeof m === "object" && m !== null ? (m as Record<string, unknown>) : {}
          )
        );
        return {
          messages,
          message: `Last ${messages.length} message(s) from OpenClaw.`,
        };
      }
      const gatewayUrl =
        typeof a.gatewayUrl === "string" ? (a.gatewayUrl as string).trim() : undefined;
      let url = gatewayUrl;
      let token: string | undefined;
      if (vaultKey) {
        const vaultUrl = await getStoredCredential("openclaw_gateway_url", vaultKey);
        const vaultToken = await getStoredCredential("openclaw_gateway_token", vaultKey);
        if (!url && vaultUrl) url = vaultUrl;
        if (vaultToken) token = vaultToken;
      }
      try {
        const limit = typeof a.limit === "number" && a.limit > 0 ? Math.min(a.limit, 50) : 20;
        const result = await openclawHistory({ limit, url, token });
        if (result.error) return { error: result.error, messages: [] };
        const rawGateway = (result.messages ?? []) as Array<{ role?: string; content?: unknown }>;
        const messages = rawGateway.map(normalizeOpenClawHistoryMessage);
        return {
          messages,
          message: `Last ${messages.length} message(s) from OpenClaw.`,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { error: `OpenClaw: ${msg}`, messages: [] };
      }
    }
    case "openclaw_abort": {
      const sandboxIdAbort = (a.sandboxId as string)?.trim();
      if (sandboxIdAbort) {
        const rows = await db.select().from(sandboxes).where(eq(sandboxes.id, sandboxIdAbort));
        if (rows.length === 0) return { error: "Sandbox not found" };
        const sb = fromSandboxRow(rows[0]);
        if (!sb.containerId) return { error: "Sandbox has no container" };
        if (!sb.image?.toLowerCase().includes("openclaw"))
          return { error: "Sandbox is not an OpenClaw container" };
        const podman = getContainerManager();
        const runId = typeof a.runId === "string" ? a.runId.trim() : undefined;
        const { error } = await runOpenclawRpcInContainer(
          sb.containerId,
          "chat.abort",
          { sessionKey: "default", ...(runId ? { runId } : {}) },
          (cid, cmd) => podman.exec(cid, cmd)
        );
        if (error) return { error: `OpenClaw: ${error}`, message: "Could not abort." };
        return { message: "OpenClaw run aborted." };
      }
      const gatewayUrl =
        typeof a.gatewayUrl === "string" ? (a.gatewayUrl as string).trim() : undefined;
      let url = gatewayUrl;
      let token: string | undefined;
      if (vaultKey) {
        const vaultUrl = await getStoredCredential("openclaw_gateway_url", vaultKey);
        const vaultToken = await getStoredCredential("openclaw_gateway_token", vaultKey);
        if (!url && vaultUrl) url = vaultUrl;
        if (vaultToken) token = vaultToken;
      }
      try {
        const result = await openclawAbort({ url, token });
        return result.ok
          ? { message: "OpenClaw run aborted." }
          : { error: result.error, message: "Could not abort." };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { error: `OpenClaw: ${msg}` };
      }
    }
    default:
      return undefined;
  }
}
