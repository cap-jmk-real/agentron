import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: [path.resolve(__dirname, "vitest.setup.ts")],
    include: ["__tests__/**/*.test.ts"],
    testTimeout: 10000,
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html"],
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
        "**/api/sandbox/**",
        "**/api/sandbox-proxy/**",
        "**/api/sandbox-site-bindings/**",
        "**/api/run-code/**",
        "**/api/runs/**/respond/**",
        "**/app/lib/system-stats-interval.ts",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "app"),
    },
  },
});
