/**
 * Container and file helpers used by workflow execution and chat tools.
 * Extracted from run-workflow.ts for maintainability.
 */
import path from "node:path";
import fs from "node:fs";
import { db, files, toFileRow, ensureAgentFilesDir } from "./db";
import { getContainerManager, withContainerInstallHint } from "./container-manager";
import { getMaxFileUploadBytes } from "./app-settings";

export type ContainerStreamChunk = { stdout?: string; stderr?: string; meta?: "container_started" | "container_stopped" };

/** Run a container one-shot (create, exec, destroy). Exported for chat. */
export async function runContainer(input: unknown, onChunk?: (chunk: ContainerStreamChunk) => void): Promise<unknown> {
  const arg = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const image = (arg.image as string)?.trim();
  const rawCommand = arg.command;
  const command =
    typeof rawCommand === "string"
      ? rawCommand.trim()
      : Array.isArray(rawCommand)
        ? rawCommand.map(String).join(" ")
        : "";
  if (!image || !command) {
    const hint =
      typeof input === "string"
        ? "The Run Container tool received text instead of { image, command }. If this agent has an LLM node followed by a tool node, remove the tool node — the LLM calls the tool internally."
        : "image and command are required";
    return { error: hint, stdout: "", stderr: hint, exitCode: -1 };
  }
  const name = `workflow-one-shot-${Date.now()}`;
  const mgr = getContainerManager();
  const isImageNotFound = (m: string) => {
    const s = m.toLowerCase();
    return s.includes("no such image") || s.includes("manifest unknown") || s.includes("not found") || s.includes("pull access denied") || s.includes("unable to find image");
  };
  let containerId: string;
  try {
    containerId = await mgr.create(image, name, {});
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isImageNotFound(msg)) {
      try {
        await mgr.pull(image);
        containerId = await mgr.create(image, name, {});
      } catch (pullErr) {
        const pullMsg = pullErr instanceof Error ? pullErr.message : String(pullErr);
        const hint = withContainerInstallHint(pullMsg);
        return { error: hint !== pullMsg ? hint : `Failed to pull/create: ${pullMsg}`, stdout: "", stderr: pullMsg, exitCode: -1 };
      }
    } else {
      const hint = withContainerInstallHint(msg);
      return { error: hint !== msg ? hint : `Failed to create container: ${msg}`, stdout: "", stderr: msg, exitCode: -1 };
    }
  }
  try {
    if (onChunk && typeof (mgr as { execStream?: unknown }).execStream === "function") {
      onChunk({ meta: "container_started" });
      try {
        return await (mgr as { execStream(containerId: string, command: string, onChunk?: (c: ContainerStreamChunk) => void): Promise<{ stdout: string; stderr: string; exitCode: number }> }).execStream(containerId, command, onChunk);
      } finally {
        onChunk({ meta: "container_stopped" });
      }
    }
    return await mgr.exec(containerId, command);
  } finally {
    try {
      await mgr.destroy(containerId);
    } catch {
      /* ignore */
    }
  }
}

const containerSessionByRunId = new Map<string, { containerId: string; image: string }>();

function destroyContainerSession(runId: string): Promise<void> {
  const session = containerSessionByRunId.get(runId);
  if (!session) return Promise.resolve();
  containerSessionByRunId.delete(runId);
  const mgr = getContainerManager();
  return mgr.destroy(session.containerId).catch(() => {});
}

/** Run-scoped or conversation-scoped container session. Exported for chat (pass conversationId as runId). */
export async function runContainerSession(
  runId: string,
  input: unknown,
  onChunk?: (chunk: ContainerStreamChunk) => void
): Promise<unknown> {
  const arg = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const action = typeof arg.action === "string" ? arg.action : "";
  const mgr = getContainerManager();
  const isImageNotFound = (m: string) => {
    const s = m.toLowerCase();
    return s.includes("no such image") || s.includes("manifest unknown") || s.includes("not found") || s.includes("pull access denied") || s.includes("unable to find image");
  };

  if (action === "ensure") {
    const image = (arg.image as string)?.trim();
    if (!image) return { error: "image is required for action ensure", stdout: "", stderr: "image is required", exitCode: -1 };
    const existing = containerSessionByRunId.get(runId);
    if (existing) return { containerId: existing.containerId, created: false, image: existing.image };
    const name = `workflow-session-${runId.slice(0, 8)}-${Date.now()}`;
    let containerId: string;
    try {
      containerId = await mgr.create(image, name, {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isImageNotFound(msg)) {
        try {
          await mgr.pull(image);
          containerId = await mgr.create(image, name, {});
        } catch (pullErr) {
          const pullMsg = pullErr instanceof Error ? pullErr.message : String(pullErr);
          const hint = withContainerInstallHint(pullMsg);
          return { error: hint !== pullMsg ? hint : `Failed to pull/create: ${pullMsg}`, stdout: "", stderr: pullMsg, exitCode: -1 };
        }
      } else {
        const hint = withContainerInstallHint(msg);
        return { error: hint !== msg ? hint : `Failed to create container: ${msg}`, stdout: "", stderr: msg, exitCode: -1 };
      }
    }
    containerSessionByRunId.set(runId, { containerId, image });
    return { containerId, created: true, image };
  }

  if (action === "exec") {
    const session = containerSessionByRunId.get(runId);
    if (!session) return { error: "No container session for this run. Call std-container-session with action ensure first.", stdout: "", stderr: "No session", exitCode: -1 };
    const rawCommand = arg.command;
    const command = typeof rawCommand === "string" ? rawCommand.trim() : Array.isArray(rawCommand) ? rawCommand.map(String).join(" ") : "";
    if (!command) return { error: "command is required for action exec", stdout: "", stderr: "command is required", exitCode: -1 };
    if (onChunk && typeof (mgr as { execStream?: unknown }).execStream === "function") {
      return await (mgr as { execStream(containerId: string, command: string, onChunk?: (c: ContainerStreamChunk) => void): Promise<{ stdout: string; stderr: string; exitCode: number }> }).execStream(session.containerId, command, onChunk);
    }
    return await mgr.exec(session.containerId, command);
  }

  if (action === "destroy") {
    await destroyContainerSession(runId);
    return { destroyed: true };
  }

  return { error: `Unknown action: ${action}. Use ensure, exec, or destroy.`, stdout: "", stderr: "Unknown action", exitCode: -1 };
}

/** Build image from Containerfile. Exported for chat. Supports inline dockerfileContent (creates temp context) or contextPath + dockerfilePath. */
export async function runContainerBuild(input: unknown): Promise<unknown> {
  const arg = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const imageTag = typeof arg.imageTag === "string" ? arg.imageTag.trim() : "";
  if (!imageTag) {
    return { error: "imageTag is required", stdout: "", stderr: "Missing imageTag", exitCode: -1 };
  }
  const inlineContent = typeof arg.dockerfileContent === "string" ? arg.dockerfileContent : "";
  let contextPath = typeof arg.contextPath === "string" ? arg.contextPath.trim() : "";
  let dockerfilePath = typeof arg.dockerfilePath === "string" ? arg.dockerfilePath.trim() : "";

  if (inlineContent) {
    const tmpId = `build-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const tmpDir = ensureAgentFilesDir(tmpId);
    const dfPath = path.join(tmpDir, "Containerfile");
    fs.writeFileSync(dfPath, inlineContent, "utf-8");
    contextPath = tmpDir;
    dockerfilePath = path.join(tmpDir, "Containerfile");
  }

  if (!contextPath || !dockerfilePath) {
    return { error: "contextPath and dockerfilePath are required, or provide dockerfileContent", stdout: "", stderr: "Missing required fields", exitCode: -1 };
  }

  const mgr = getContainerManager();
  try {
    await mgr.build(contextPath, dockerfilePath, imageTag);
    return { imageTag, built: true, stdout: "", stderr: "", exitCode: 0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const hint = withContainerInstallHint(msg);
    return { error: hint !== msg ? hint : `Build failed: ${msg}`, stdout: "", stderr: msg, exitCode: -1 };
  }
}

/** Write a file to agent-files/{contextId}, insert into files table. Exported for chat. */
export async function runWriteFile(input: unknown, contextId: string): Promise<unknown> {
  const arg = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const name = typeof arg.name === "string" ? arg.name.trim() : "";
  const content = typeof arg.content === "string" ? arg.content : "";
  if (!name) {
    return { error: "name is required", id: null, name: null, path: null, contextDir: null };
  }
  const maxBytes = getMaxFileUploadBytes();
  const buf = Buffer.from(content, "utf-8");
  if (buf.length > maxBytes) {
    return { error: `Content too large (max ${Math.round(maxBytes / 1024 / 1024)}MB)`, id: null, name: null, path: null, contextDir: null };
  }
  const dir = ensureAgentFilesDir(contextId);
  const id = crypto.randomUUID();
  const ext = path.extname(name) || "";
  const storedName = `${id}${ext}`;
  const filePath = path.join(dir, storedName);
  fs.writeFileSync(filePath, buf, "utf-8");
  const entry = {
    id,
    name,
    mimeType: "text/plain",
    size: buf.length,
    path: `agent-files/${contextId}/${storedName}`,
    createdAt: Date.now(),
  };
  await db.insert(files).values(toFileRow(entry)).run();
  return { id: entry.id, name: entry.name, path: entry.path, contextDir: dir };
}
