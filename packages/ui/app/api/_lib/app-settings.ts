import path from "node:path";
import fs from "node:fs";
import { getDataDir } from "./db";

const DEFAULT_MAX_FILE_UPLOAD_BYTES = 50 * 1024 * 1024; // 50MB
const MIN_MAX_BYTES = 1 * 1024 * 1024; // 1MB
const MAX_MAX_BYTES = 500 * 1024 * 1024; // 500MB

export type ContainerEngine = "podman" | "docker";

export type AppSettings = {
  maxFileUploadBytes: number;
  containerEngine: ContainerEngine;
};

function getSettingsPath(): string {
  return path.join(getDataDir(), "app-settings.json");
}

function loadRaw(): Partial<AppSettings> {
  const p = getSettingsPath();
  if (!fs.existsSync(p)) return {};
  try {
    const raw = fs.readFileSync(p, "utf-8");
    return JSON.parse(raw) as Partial<AppSettings>;
  } catch {
    return {};
  }
}

function save(settings: AppSettings): void {
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), "utf-8");
}

/**
 * Returns the configured max file upload size in bytes (used by /api/files and /api/rag/upload).
 * Default 50MB if unset or invalid.
 */
export function getMaxFileUploadBytes(): number {
  const raw = loadRaw();
  const v = raw.maxFileUploadBytes;
  if (typeof v !== "number" || Number.isNaN(v) || v < MIN_MAX_BYTES || v > MAX_MAX_BYTES) {
    return DEFAULT_MAX_FILE_UPLOAD_BYTES;
  }
  return Math.floor(v);
}

function normalizeContainerEngine(v: unknown): ContainerEngine {
  return v === "docker" ? "docker" : "podman";
}

/**
 * Returns the configured container engine (used by API routes that run containers).
 * Default "podman" if unset or invalid.
 */
export function getContainerEngine(): ContainerEngine {
  return normalizeContainerEngine(loadRaw().containerEngine);
}

/**
 * Returns full app settings for the settings API (GET).
 */
export function getAppSettings(): AppSettings {
  const raw = loadRaw();
  const max = raw.maxFileUploadBytes;
  const maxFileUploadBytes =
    typeof max === "number" && !Number.isNaN(max) && max >= MIN_MAX_BYTES && max <= MAX_MAX_BYTES
      ? Math.floor(max)
      : DEFAULT_MAX_FILE_UPLOAD_BYTES;
  const containerEngine = normalizeContainerEngine(raw.containerEngine);
  return { maxFileUploadBytes, containerEngine };
}

/**
 * Updates app settings. Validates and clamps maxFileUploadBytes to [1MB, 500MB].
 * Accepts containerEngine "podman" | "docker".
 */
export function updateAppSettings(updates: Partial<AppSettings>): AppSettings {
  const current = getAppSettings();
  let maxFileUploadBytes = current.maxFileUploadBytes;
  if (updates.maxFileUploadBytes !== undefined) {
    const v = Number(updates.maxFileUploadBytes);
    if (!Number.isNaN(v)) {
      maxFileUploadBytes = Math.floor(Math.min(MAX_MAX_BYTES, Math.max(MIN_MAX_BYTES, v)));
    }
  }
  const containerEngine =
    updates.containerEngine !== undefined ? normalizeContainerEngine(updates.containerEngine) : current.containerEngine;
  const next: AppSettings = { maxFileUploadBytes, containerEngine };
  save(next);
  return next;
}

export function formatMaxFileUploadMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
