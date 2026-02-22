/**
 * E2E setup: Ollama health check and DB seed (LLM config). Runs once before the first e2e test.
 */

import { beforeAll } from "vitest";
import { db, llmConfigs, toLlmConfigRow, ensureStandardTools } from "../../app/api/_lib/db";
import { eq } from "drizzle-orm";

export const E2E_LLM_CONFIG_ID = "e2e-ollama-config";

/** Same as other e2e tests; used by OpenClaw e2e for in-container Ollama. */
export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
export const E2E_LLM_MODEL = process.env.E2E_LLM_MODEL ?? "qwen2.5:3b";

declare global {
  // eslint-disable-next-line no-var
  var __e2eOllamaAvailable: boolean | undefined;
  // eslint-disable-next-line no-var
  var __e2eSetupDone: boolean | undefined;
}

async function checkOllama(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function seedE2ELLMConfig(): Promise<void> {
  const existing = await db
    .select()
    .from(llmConfigs)
    .where(eq(llmConfigs.id, E2E_LLM_CONFIG_ID))
    .limit(1);
  if (existing.length > 0) return;
  await db
    .insert(llmConfigs)
    .values(
      toLlmConfigRow({
        id: E2E_LLM_CONFIG_ID,
        provider: "local",
        model: E2E_LLM_MODEL,
        endpoint: OLLAMA_BASE_URL,
      })
    )
    .run();
}

async function ensureE2ESetup(): Promise<void> {
  if (globalThis.__e2eSetupDone) return;
  const ok = await checkOllama();
  if (!ok) {
    console.log(
      "[e2e] Ollama not available at",
      OLLAMA_BASE_URL,
      ". Install from https://ollama.com and run `ollama pull <model>` (e.g. qwen2.5:3b)."
    );
    globalThis.__e2eOllamaAvailable = false;
    globalThis.__e2eSetupDone = true;
    process.exit(0);
  }
  await seedE2ELLMConfig();
  await ensureStandardTools();
  globalThis.__e2eOllamaAvailable = true;
  globalThis.__e2eSetupDone = true;
}

beforeAll(ensureE2ESetup, 15_000);

export function isOllamaAvailable(): boolean {
  return globalThis.__e2eOllamaAvailable === true;
}
