import { execFile, spawn } from "node:child_process";
import { platform } from "node:os";
import { promisify } from "node:util";
import type { SandboxConfig } from "@agentron-studio/core";

const run = promisify(execFile);

export type ContainerStreamChunk = { stdout?: string; stderr?: string };

const LABEL = "agentos=true";
const DEFAULT_TIMEOUT = 30_000;

export type ContainerEngine = "podman" | "docker";

/** Escape a string for PowerShell single-quoted literal (double internal single quotes). */
function escapePsArg(s: string): string {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

export class PodmanManager {
  private bin: string;

  constructor(options?: { engine?: ContainerEngine }) {
    this.bin = options?.engine === "docker" ? "docker" : "podman";
  }

  private async podman(...args: string[]): Promise<{ stdout: string; stderr: string }> {
    const isWin = platform() === "win32";
    if (isWin) {
      // On Windows, run via PowerShell with PATH refreshed from registry so podman/docker
      // in user PATH (e.g. from PowerShell) is found.
      const pathRefresh =
        "$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')";
      const binArg = escapePsArg(this.bin);
      const argList = args.map(escapePsArg).join(" ");
      const cmd = `${pathRefresh}; & ${binArg} ${argList}`;
      return new Promise((resolve, reject) => {
        const proc = spawn(
          "powershell.exe",
          ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd],
          {
            stdio: ["ignore", "pipe", "pipe"],
          }
        );
        let stdout = "";
        let stderr = "";
        proc.stdout?.on("data", (d: Buffer) => {
          stdout += d.toString();
        });
        proc.stderr?.on("data", (d: Buffer) => {
          stderr += d.toString();
        });
        proc.on("error", reject);
        proc.on("close", (code, signal) => {
          if (code === 0) resolve({ stdout, stderr });
          else {
            const err = new Error(stderr || stdout || `exit ${code ?? signal}`) as Error & {
              stdout?: string;
              stderr?: string;
              code?: number;
            };
            err.stdout = stdout;
            err.stderr = stderr;
            err.code = code ?? (signal === "SIGKILL" ? 137 : 1);
            reject(err);
          }
        });
      });
    }
    return run(this.bin, args, { timeout: DEFAULT_TIMEOUT, shell: true });
  }

  async create(image: string, name: string, config?: SandboxConfig): Promise<string> {
    const args = ["run", "-d", "--label", LABEL, "--name", name];

    if (config?.memory) args.push(`--memory=${config.memory}`);
    if (config?.cpus) args.push(`--cpus=${config.cpus}`);
    if (!config?.network) args.push("--network=none");
    if (config?.env) {
      for (const [k, v] of Object.entries(config.env)) {
        args.push("-e", `${k}=${v}`);
      }
    }
    if (config?.ports) {
      for (const [host, container] of Object.entries(config.ports)) {
        args.push("-p", `${host}:${container}`);
      }
    }

    if (config?.useImageCmd) {
      args.push(image);
    } else {
      args.push(image, "sleep", "infinity");
    }

    const { stdout } = await this.podman(...args);
    return stdout.trim();
  }

  async exec(
    containerId: string,
    command: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    try {
      const { stdout, stderr } = await this.podman("exec", containerId, "sh", "-c", command);
      return { stdout, stderr, exitCode: 0 };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
      return {
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? e.message ?? String(err),
        exitCode: e.code ?? 1,
      };
    }
  }

  /**
   * Run a command in the container and stream stdout/stderr to onChunk as they arrive.
   * Returns the same shape as exec when the process exits.
   */
  async execStream(
    containerId: string,
    command: string,
    onChunk?: (chunk: ContainerStreamChunk) => void
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const isWin = platform() === "win32";
    const args = ["exec", containerId, "sh", "-c", command];
    let proc: ReturnType<typeof spawn>;
    if (isWin) {
      const pathRefresh =
        "$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')";
      const binArg = escapePsArg(this.bin);
      const argList = args.map(escapePsArg).join(" ");
      const cmd = `${pathRefresh}; & ${binArg} ${argList}`;
      proc = spawn(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd],
        { stdio: ["ignore", "pipe", "pipe"] }
      );
    } else {
      proc = spawn(this.bin, args, { shell: true });
    }
    return new Promise((resolve, reject) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      proc.stdout?.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
        if (onChunk) onChunk({ stdout: chunk.toString("utf8") });
      });
      proc.stderr?.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
        if (onChunk) onChunk({ stderr: chunk.toString("utf8") });
      });
      proc.on("error", (err) => reject(err));
      proc.on("close", (code, signal) => {
        const stdout = Buffer.concat(stdoutChunks).toString("utf8");
        const stderr = Buffer.concat(stderrChunks).toString("utf8");
        const exitCode =
          code !== null && code !== undefined ? code : signal === "SIGKILL" ? 137 : 1;
        resolve({ stdout, stderr, exitCode });
      });
    });
  }

  async copyToContainer(
    containerId: string,
    hostPath: string,
    containerPath: string
  ): Promise<void> {
    await this.podman("cp", hostPath, `${containerId}:${containerPath}`);
  }

  async destroy(containerId: string): Promise<void> {
    await this.podman("rm", "-f", containerId);
  }

  /** Start an existing stopped container. */
  async start(containerId: string): Promise<void> {
    await this.podman("start", containerId);
  }

  /** Stop a running container (without removing it). */
  async stop(containerId: string): Promise<void> {
    await this.podman("stop", containerId);
  }

  /** Pull an image. Works for both Podman and Docker (uses configured engine). */
  async pull(image: string): Promise<void> {
    await this.podman("pull", image);
  }

  /**
   * Build an image from a Containerfile/Dockerfile.
   * @param contextPath - Path to the build context directory (e.g. "." or absolute path).
   * @param dockerfilePath - Path to the Containerfile or Dockerfile (relative to context or absolute).
   * @param imageTag - Tag for the built image (e.g. "myapp:latest").
   */
  async build(contextPath: string, dockerfilePath: string, imageTag: string): Promise<void> {
    await this.podman("build", "-t", imageTag, "-f", dockerfilePath, contextPath);
  }

  async list(): Promise<string[]> {
    const { stdout } = await this.podman(
      "ps",
      "-a",
      "--filter",
      `label=${LABEL}`,
      "--format",
      "{{.ID}}"
    );
    return stdout.trim().split("\n").filter(Boolean);
  }

  async logs(containerId: string, tail = 100): Promise<string> {
    const { stdout } = await this.podman("logs", "--tail", String(tail), containerId);
    return stdout;
  }
}
