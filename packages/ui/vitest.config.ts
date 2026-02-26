import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

function ciMaxWorkers(): number | undefined {
  if (!process.env.CI) return undefined;
  if (process.platform === "win32") {
    // Windows CI: 2–4 workers to parallelize without oversubscribing 2-core runners.
    const cpus = os.cpus().length || 2;
    return Math.min(4, Math.max(2, cpus));
  }
  return 2;
}

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: [path.resolve(__dirname, "vitest.setup.ts")],
    include: ["__tests__/**/*.test.ts"],
    testTimeout: 20_000,
    // Parallel workers; each worker has its own DB/data dir via vitest.setup.ts (VITEST_POOL_ID).
    // Override in CI with VITEST_MAX_WORKERS (e.g. 8) to speed up Windows.
    maxWorkers: (() => {
      const n = Number(process.env.VITEST_MAX_WORKERS);
      return Number.isInteger(n) && n > 0 ? n : ciMaxWorkers();
    })(),
    // On Windows, fork pool is faster than threads (Node worker_threads overhead); use in CI too.
    pool: process.platform === "win32" ? "forks" : undefined,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html", "lcov", "json-summary"],
      include: ["app/**/*.ts"],
      thresholds: {
        lines: 70,
        statements: 70,
        functions: 70,
        branches: 70,
      },
      exclude: [
        "**/__tests__/**",
        "**/node_modules/**",
        "**/*.d.ts",
        // Chat POST handler is LLM/runtime-heavy; covered by integration/E2E. See __tests__/README.md.
        "**/api/chat/route.ts",
        // Intentional gaps: external I/O, runtime/containers, or browser-only. See __tests__/README.md.
        "**/api/_lib/s3.ts",
        "**/api/_lib/remote-test.ts",
        "**/api/_lib/run-workflow.ts",
        "**/api/ollama/**",
        // OpenClaw Gateway WebSocket client and proxy routes; external service. See docs/openclaw-integration.md.
        "**/api/_lib/openclaw-client.ts",
        "**/api/openclaw/**",
        "**/api/sandbox/**",
        "**/api/sandbox-shell/**",
        "**/api/sandbox-proxy/**",
        "**/api/sandbox-site-bindings/**",
        "**/api/run-code/**",
        "**/api/runs/**/respond/**",
        "**/app/lib/system-stats-interval.ts",
        // Browser-only layout/draft/cache; unit-test with jsdom if needed. See __tests__/README.md.
        "**/app/lib/canvas-layout.ts",
        "**/app/lib/chat-drafts.ts",
        "**/app/lib/chat-state-cache.ts",
        // Browser-only hooks (DOM, React context); unit-test with jsdom if needed. See __tests__/README.md.
        "**/app/hooks/**",
        // Browser-only React components; unit-test with jsdom if needed. See __tests__/README.md.
        "**/app/components/**",
        // Setup flow; env/onboarding. See __tests__/README.md.
        "**/api/setup/**",
        // LLM/external or heavy; covered by integration or manual. See __tests__/README.md.
        "**/api/chat/refine-prompt/**",
        "**/api/chat/types.ts",
        "**/api/debug/**",
        "**/api/home/**",
        "**/api/llm/models/**",
        "**/api/llm/providers/**/openrouter-key/**",
        "**/api/llm/providers/**/test/**",
        "**/api/remote-servers/test/**",
        // _lib: browser-only or long-running. See __tests__/README.md.
        "**/api/_lib/telegram-polling.ts",
        // Empty stub; no executable code. See __tests__/lib/suggested-models.test.ts.
        "**/settings/local/suggested-models.ts",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "app"),
    },
  },
});
