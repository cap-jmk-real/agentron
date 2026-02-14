import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SandboxConfig } from "@agentron-studio/core";

const run = promisify(execFile);

const LABEL = "agentos=true";
const DEFAULT_TIMEOUT = 30_000;

export type ContainerEngine = "podman" | "docker";

export class PodmanManager {
  private bin: string;

  constructor(options?: { engine?: ContainerEngine }) {
    this.bin = options?.engine === "docker" ? "docker" : "podman";
  }

  private async podman(...args: string[]): Promise<{ stdout: string; stderr: string }> {
    return run(this.bin, args, { timeout: DEFAULT_TIMEOUT });
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

    args.push(image, "sleep", "infinity");

    const { stdout } = await this.podman(...args);
    return stdout.trim();
  }

  async exec(containerId: string, command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    try {
      const { stdout, stderr } = await run(
        this.bin,
        ["exec", containerId, "sh", "-c", command],
        { timeout: DEFAULT_TIMEOUT }
      );
      return { stdout, stderr, exitCode: 0 };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number };
      return {
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? String(err),
        exitCode: e.code ?? 1
      };
    }
  }

  async copyToContainer(containerId: string, hostPath: string, containerPath: string): Promise<void> {
    await this.podman("cp", hostPath, `${containerId}:${containerPath}`);
  }

  async destroy(containerId: string): Promise<void> {
    await this.podman("rm", "-f", containerId);
  }

  async list(): Promise<string[]> {
    const { stdout } = await this.podman("ps", "-a", "--filter", `label=${LABEL}`, "--format", "{{.ID}}");
    return stdout.trim().split("\n").filter(Boolean);
  }

  async logs(containerId: string, tail = 100): Promise<string> {
    const { stdout } = await this.podman("logs", "--tail", String(tail), containerId);
    return stdout;
  }
}
