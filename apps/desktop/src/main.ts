import { app, BrowserWindow } from "electron";
import path from "node:path";
import { initializeLocalRuntime } from "./runtime";

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js")
    }
  });

  const url = process.env.AGENTRON_STUDIO_URL ?? "http://localhost:3000";
  void mainWindow.loadURL(url);
};

let runtimeClose: (() => void) | null = null;

app.whenReady().then(() => {
  try {
    const adapter = initializeLocalRuntime();
    runtimeClose = () => adapter.close();
  } catch (err) {
    console.warn("[desktop] Local runtime unavailable (dev mode):", (err as Error).message);
  }
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  runtimeClose?.();
});
