/** UUID v4; works in insecure context where crypto.randomUUID is not available */
export function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Build a short UI context string for the assistant from the current path. */
export function getUiContext(pathname: string | null): string {
  if (!pathname || pathname === "/") return "User is on the home/dashboard.";
  const segments = pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (segments[0] === "workflows") {
    if (segments[1])
      return `User is on the workflow detail page (editing workflow id: ${segments[1]}).`;
    return "User is on the workflows list page.";
  }
  if (segments[0] === "agents") {
    if (segments[1]) return `User is on the agent detail page (editing agent id: ${segments[1]}).`;
    return "User is on the agents list page.";
  }
  if (segments[0] === "runs") {
    if (segments[1]) return `User is on the run detail page (run id: ${segments[1]}).`;
    return "User is on the runs list page.";
  }
  if (segments[0] === "tools") {
    if (segments[1]) return `User is on the tool detail page (tool id: ${segments[1]}).`;
    return "User is on the tools list page.";
  }
  if (pathname.startsWith("/knowledge")) return "User is on the knowledge / RAG page.";
  if (pathname.startsWith("/settings")) return "User is on the settings area.";
  if (pathname.startsWith("/requests")) return "User is on the requests page.";
  if (pathname.startsWith("/stats")) return "User is on the stats page.";
  if (pathname.startsWith("/chat")) return "User is on the Agentron chat page.";
  return `User is on: ${pathname}.`;
}

/** Copy text to clipboard; works in insecure contexts (HTTP) via execCommand fallback. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function"
    ) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to fallback
  }
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

export function getToolResultCopyLine(result: unknown): string {
  if (result === null || result === undefined) return "done";
  if (typeof result === "object" && "message" in (result as Record<string, unknown>))
    return String((result as Record<string, unknown>).message);
  if (typeof result === "string") return result;
  return "done";
}

/** Minimal shape needed for copy text; used by both chat-modal and chat-section. */
export type MessageForCopy = { content: string; toolResults?: { name: string; result: unknown }[] };

export function getMessageCopyText(msg: MessageForCopy): string {
  const parts: string[] = [];
  if (msg.content.trim()) parts.push(msg.content.trim());
  if (msg.toolResults && msg.toolResults.length > 0) {
    parts.push("");
    parts.push("Tool results:");
    for (const r of msg.toolResults) {
      parts.push(`${r.name}: ${getToolResultCopyLine(r.result)}`);
    }
  }
  return parts.join("\n");
}
