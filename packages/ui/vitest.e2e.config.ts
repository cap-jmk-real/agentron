import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: [
      path.resolve(__dirname, "vitest.setup.ts"),
      path.resolve(__dirname, "__tests__/e2e/e2e-setup.ts"),
    ],
    include: ["__tests__/e2e/**/*.e2e.ts"],
    testTimeout: 120_000,
    maxWorkers: process.env.CI ? 2 : 4,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "app"),
    },
  },
});
