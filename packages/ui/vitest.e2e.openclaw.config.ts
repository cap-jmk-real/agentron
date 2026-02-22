import path from "node:path";
import { defineConfig } from "vitest/config";

/** Run only OpenClaw e2e (container + token injection). Excluded from default e2e because it requires Podman. */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: [
      path.resolve(__dirname, "vitest.setup.ts"),
      path.resolve(__dirname, "__tests__/e2e/e2e-setup.ts"),
    ],
    include: ["__tests__/e2e/openclaw.e2e.ts"],
    testTimeout: 120_000,
    maxWorkers: 1,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "app"),
    },
  },
});
