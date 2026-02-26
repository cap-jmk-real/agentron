#!/usr/bin/env node
/**
 * Run E2E tests with local LLM (Ollama). Ensures Ollama is running (starts it if not), then runs the E2E suite.
 * Usage: npm run test:e2e-llm (from repo root)
 */

import { spawn, spawnSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const E2E_LLM_MODEL = process.env.E2E_LLM_MODEL ?? "qwen3:8b";
const POLL_INTERVAL_MS = 1800;
const POLL_TIMEOUT_MS = 30_000;

async function ollamaHealthy() {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function hasModel(modelTag) {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return false;
    const data = await res.json();
    const names = (data.models ?? []).map((m) => m.name ?? m.model ?? "").filter(Boolean);
    return names.some((n) => n === modelTag || n.startsWith(modelTag + ":"));
  } catch {
    return false;
  }
}

async function waitForOllama() {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await ollamaHealthy()) return true;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

async function ensureOllama() {
  if (await ollamaHealthy()) return;
  console.log("[e2e] Ollama not running at", OLLAMA_BASE_URL, "- starting ollama serve...");
  try {
    const child = spawn("ollama", ["serve"], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch (err) {
    console.error("[e2e] Failed to start Ollama:", err?.message ?? err);
    console.error(
      "Install Ollama from https://ollama.com, run `ollama pull qwen2.5:3b` (or your chosen model), then run this script again."
    );
    process.exit(1);
  }
  const ok = await waitForOllama();
  if (!ok) {
    console.error("[e2e] Ollama did not become ready in time.");
    console.error(
      "Install Ollama from https://ollama.com, run `ollama pull qwen2.5:3b` (or your chosen model), and optionally start it with `ollama serve`."
    );
    process.exit(1);
  }
  console.log("[e2e] Ollama is ready.");
}

await ensureOllama();

if (!(await hasModel(E2E_LLM_MODEL.split(":")[0] || E2E_LLM_MODEL))) {
  console.log("[e2e] Pulling E2E model", E2E_LLM_MODEL, "...");
  const pull = spawnSync("ollama", ["pull", E2E_LLM_MODEL], {
    stdio: "inherit",
    cwd: root,
    env: process.env,
  });
  if (pull.status !== 0) {
    console.error("[e2e] ollama pull failed with status", pull.status);
    process.exit(pull.status ?? 1);
  }
} else {
  console.log("[e2e] Model", E2E_LLM_MODEL, "already present.");
}

// Forward only test file paths and vitest options. Strip --workspace and its value so they are not passed to vitest.
// Use spawn with explicit args and -- so npm forwards extra args to the script (per npm run-script docs).
const rawArgs = process.argv.slice(2).filter((a) => a.length > 0);
const extraArgs = [];
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === "--workspace" || rawArgs[i] === "-w") {
    i++;
    continue;
  }
  if (rawArgs[i].startsWith("--workspace=") || rawArgs[i].startsWith("-w=")) continue;
  extraArgs.push(rawArgs[i]);
}
const npmArgs = ["run", "test:e2e-llm", "--workspace", "packages/ui", "--", ...extraArgs];
const child = spawn("npm", npmArgs, {
  stdio: "inherit",
  cwd: root,
  env: process.env,
  shell: false,
});
const code = await new Promise((resolve) => {
  child.on("close", resolve);
});
process.exit(code ?? 1);
