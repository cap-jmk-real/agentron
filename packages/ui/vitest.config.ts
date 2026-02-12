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
      exclude: [
        "**/__tests__/**",
        "**/node_modules/**",
        "**/*.d.ts",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "app"),
    },
  },
});
