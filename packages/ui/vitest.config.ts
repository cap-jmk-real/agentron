import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: [path.resolve(__dirname, "vitest.setup.ts")],
    include: ["__tests__/**/*.test.ts"],
    testTimeout: 10000,
    // Parallel workers; each worker has its own DB/data dir via vitest.setup.ts (VITEST_POOL_ID).
    maxWorkers: process.env.CI ? 2 : undefined,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html", "lcov"],
      include: ["app/**/*.ts"],
      thresholds: {
        lines: 70,
        statements: 70,
        functions: 70,
        branches: 55,
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
        "**/api/sandbox-proxy/**",
        "**/api/sandbox-site-bindings/**",
        "**/api/run-code/**",
        "**/api/runs/**/respond/**",
        "**/app/lib/system-stats-interval.ts",
        // Browser-only hooks (DOM, React context); unit-test with jsdom if needed. See __tests__/README.md.
        "**/app/hooks/**",
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
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "app"),
    },
  },
});
