#!/usr/bin/env node
/**
 * Run E2E tests with local LLM (Ollama). Ensures Ollama is running (starts it if not), then runs the E2E suite.
 * Usage: npm run test:e2e-llm (from repo root)
 */

import { spawn } from "child_process";
import { execSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
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

execSync("npm run test:e2e-llm --workspace packages/ui", {
  stdio: "inherit",
  cwd: root,
  env: process.env,
});
