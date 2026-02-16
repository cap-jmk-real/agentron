import { spawn } from "node:child_process";
import { platform } from "node:os";
import { PodmanManager } from "@agentron-studio/runtime";
import { getContainerEngine } from "./app-settings";

/** Docker and Podman install URLs shown when container tool is unavailable. */
export const CONTAINER_INSTALL_LINKS = {
  docker: "https://docs.docker.com/get-docker/",
  podman: "https://podman.io/getting-started/installation",
} as const;

/**
 * Returns true if the error message indicates Docker/Podman is not installed or not available.
 */
export function isContainerUnavailableError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("enoent") ||
    m.includes("command not found") ||
    m.includes("is not recognized") ||
    m.includes("not found: 'podman'") ||
    m.includes("not found: 'docker'")
  );
}

/**
 * If the error indicates Docker/Podman is unavailable, appends a reminder to install
 * with links. Otherwise returns the original message.
 */
export function withContainerInstallHint(message: string): string {
  if (!isContainerUnavailableError(message)) return message;
  return `${message}\n\nInstall a container runtime to run workflows that use containers. Choose Docker or Podman:\n• Docker: ${CONTAINER_INSTALL_LINKS.docker}\n• Podman: ${CONTAINER_INSTALL_LINKS.podman}\n\nConfigure your choice in Settings → Container Engine.`;
}

/**
 * Returns a container manager configured with the current app setting (Podman or Docker).
 * Call per request so engine changes take effect without restart.
 */
export function getContainerManager(): PodmanManager {
  return new PodmanManager({ engine: getContainerEngine() });
}

/**
 * Verifies that the configured container engine (Podman or Docker) is installed and usable.
 * Returns { ok: true } or { ok: false, error: string }.
 */
export async function verifyContainerEngine(): Promise<{ ok: boolean; error?: string }> {
  const engine = getContainerEngine();
  const bin = engine === "docker" ? "docker" : "podman";
  const isWin = platform() === "win32";
  try {
    if (isWin) {
      const pathRefresh = "$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')";
      const cmd = `${pathRefresh}; & '${bin}' info`;
      await new Promise<void>((resolve, reject) => {
        const proc = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stderr = "";
        proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
        proc.on("error", reject);
        proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr || `exit ${code}`))));
      });
    } else {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      await execFileAsync(bin, ["info"], { timeout: 5000, shell: true });
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}
