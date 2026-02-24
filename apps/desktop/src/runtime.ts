import path from "node:path";
import { app } from "electron";
import { createSqliteAdapter } from "@agentron-studio/core";

export const initializeLocalRuntime = () => {
  try {
    const dbPath = path.join(app.getPath("userData"), "agentron.sqlite");
    const adapter = createSqliteAdapter(dbPath);
    adapter.initialize?.();
    console.log("[runtime] SQLite initialized at", dbPath);
    return adapter;
  } catch (err) {
    // In dev mode, better-sqlite3 is compiled for system Node, not Electron's Node.
    // The Next.js dev server handles DB in that case — this is expected.
    console.warn(
      "[runtime] Skipping local DB (native module mismatch — expected in dev mode):",
      (err as Error).message
    );
    return { db: null, close: () => {} };
  }
};
