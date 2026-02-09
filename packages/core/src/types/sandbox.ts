export type SandboxStatus = "creating" | "running" | "stopped" | "destroyed";

export interface SandboxConfig {
  memory?: string;
  cpus?: number;
  network?: boolean;
  env?: Record<string, string>;
  ports?: Record<string, number>;
}

export interface Sandbox {
  id: string;
  name: string;
  image: string;
  status: SandboxStatus;
  containerId?: string;
  config: SandboxConfig;
  createdAt: number;
}

export const PRESET_IMAGES: Record<string, string> = {
  "node": "node:22-slim",
  "python": "python:3.12-slim",
  "go": "golang:1.22-alpine",
  "rust": "rust:1.78-slim",
  "ubuntu": "ubuntu:24.04",
  "postgres": "postgres:16-alpine",
  "redis": "redis:7-alpine",
};
