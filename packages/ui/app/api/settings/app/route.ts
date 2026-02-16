import { json } from "../../_lib/response";
import { getAppSettings, updateAppSettings } from "../../_lib/app-settings";
import { verifyContainerEngine } from "../../_lib/container-manager";
import { logApiError } from "../../_lib/api-logger";
import { platform } from "node:os";

export const runtime = "nodejs";

/** Split compound command by OS separators (Windows: &, &&, ||; Unix: ;, &&, ||). Does not split inside quotes. */
function splitShellCommands(command: string): string[] {
  const isWin = platform() === "win32";
  const separators = isWin ? ["&&", "||", "&"] : ["&&", "||", ";"];
  const result: string[] = [];
  let remaining = command;
  while (remaining.length > 0) {
    let earliest = { index: -1, len: 0 };
    for (const sep of separators) {
      const idx = indexOfOutsideQuotes(remaining, sep);
      if (idx >= 0 && (earliest.index < 0 || idx < earliest.index)) earliest = { index: idx, len: sep.length };
    }
    if (earliest.index < 0) {
      const t = remaining.trim();
      if (t) result.push(t);
      break;
    }
    const part = remaining.slice(0, earliest.index).trim();
    if (part) result.push(part);
    remaining = remaining.slice(earliest.index + earliest.len);
  }
  return result;
}
function indexOfOutsideQuotes(str: string, sub: string): number {
  let i = 0, inSingle = false, inDouble = false;
  while (i <= str.length - sub.length) {
    const c = str[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble && str.slice(i, i + sub.length) === sub) return i;
    i++;
  }
  return -1;
}

/** GET returns general app settings (e.g. max file upload size) and container engine status. */
export async function GET() {
  try {
    const settings = getAppSettings();
    const containerStatus = await verifyContainerEngine();
    return json({
      ...settings,
      containerEngineOk: containerStatus.ok,
      containerEngineError: containerStatus.error,
    });
  } catch (e) {
    logApiError("/api/settings/app", "GET", e);
    const message = e instanceof Error ? e.message : "Failed to load settings";
    return json({ error: message }, { status: 500 });
  }
}

/** PATCH updates general app settings. Body: { maxFileUploadBytes?, containerEngine?, shellCommandAllowlist?, workflowMaxSelfFixRetries? (0-10) }. */
export async function PATCH(request: Request) {
  try {
    const payload = await request.json().catch(() => ({}));
    const updates: { maxFileUploadBytes?: number; containerEngine?: "podman" | "docker"; shellCommandAllowlist?: string[]; workflowMaxSelfFixRetries?: number } = {};
    if (payload.maxFileUploadBytes !== undefined) {
      const v = Number(payload.maxFileUploadBytes);
      if (!Number.isNaN(v)) updates.maxFileUploadBytes = v;
    }
    if (payload.containerEngine !== undefined && (payload.containerEngine === "podman" || payload.containerEngine === "docker")) {
      updates.containerEngine = payload.containerEngine;
    }
    if (payload.shellCommandAllowlist !== undefined && Array.isArray(payload.shellCommandAllowlist)) {
      updates.shellCommandAllowlist = payload.shellCommandAllowlist.filter((x: unknown) => typeof x === "string" && x.trim().length > 0).map((s: string) => s.trim());
    }
    if (payload.workflowMaxSelfFixRetries !== undefined) {
      const v = Number(payload.workflowMaxSelfFixRetries);
      if (!Number.isNaN(v) && v >= 0 && v <= 10) updates.workflowMaxSelfFixRetries = Math.floor(v);
    }
    const addedCommands: string[] = [];
    if (payload.addShellCommand !== undefined && typeof payload.addShellCommand === "string" && payload.addShellCommand.trim()) {
      const settings = getAppSettings();
      const raw = payload.addShellCommand.trim();
      const commands = splitShellCommands(raw);
      let nextAllowlist = [...settings.shellCommandAllowlist];
      const toAdd = commands.length > 1 ? [raw, ...commands] : commands;
      for (const cmd of toAdd) {
        if (cmd && !nextAllowlist.includes(cmd)) {
          nextAllowlist = [...nextAllowlist, cmd];
          addedCommands.push(cmd);
        }
      }
      if (nextAllowlist.length !== settings.shellCommandAllowlist.length) {
        updates.shellCommandAllowlist = nextAllowlist;
      }
    }
    const settings = updateAppSettings(updates);
    return json(addedCommands.length > 0 ? { ...settings, addedCommands } : settings);
  } catch (e) {
    logApiError("/api/settings/app", "PATCH", e);
    const message = e instanceof Error ? e.message : "Failed to update settings";
    return json({ error: message }, { status: 500 });
  }
}
