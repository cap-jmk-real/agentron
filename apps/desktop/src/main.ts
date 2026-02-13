import { app, BrowserWindow, dialog, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import { initializeLocalRuntime } from "./runtime";

/** Port for dev fallback (e.g. AGENTRON_STUDIO_URL or localhost). Leave 3000 free for `npm run dev:ui`. */
const DEV_PORT = 3000;
const SERVER_WAIT_MS = 30_000;

/** When packaged, pick an available port so the app doesn't bind to 3000 and conflict with dev server. */
function findAvailablePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = addr && typeof addr === "object" && "port" in addr ? addr.port : DEV_PORT + 1;
      server.close(() => resolve(port));
    });
    server.on("error", () => {
      server.close(() => resolve(DEV_PORT + 1));
    });
  });
}

/** Log to userData so you can inspect when the app doesn't open. */
function logLine(msg: string): void {
  try {
    const dir = app.getPath("userData");
    const logPath = path.join(dir, "agentron-desktop.log");
    const line = `${new Date().toISOString()} ${msg}\n`;
    fs.appendFileSync(logPath, line);
  } catch {
    // ignore
  }
}

/** Data URL for an error page when the server fails to start (avoids blank window). */
function errorPageDataUrl(logPath: string): string {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Agentron</title></head><body style="font-family:sans-serif;padding:2rem;max-width:40rem;">
<h1>Server didn't start</h1>
<p>Agentron couldn't start the UI server. Check the log for details:</p>
<p><code style="background:#eee;padding:2px 6px;word-break:break-all;">${logPath.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")}</code></p>
<p>Then try restarting the app.</p>
</body></html>`;
  return "data:text/html;charset=utf-8," + encodeURIComponent(html);
}

const createWindow = (url: string) => {
  logLine(`Creating window with URL: ${url}`);
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js")
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    logLine("Window ready-to-show");
  });

  // If page never loads (e.g. server not ready), show window after 8s so user sees something
  setTimeout(() => {
    if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
      logLine("Window shown after timeout (page may still be loading)");
    }
  }, 8000);

  mainWindow.webContents.on("did-fail-load", (_event, code, desc, urlLoaded) => {
    logLine(`did-fail-load: ${code} ${desc} ${urlLoaded}`);
  });

  void mainWindow.loadURL(url);
};

let runtimeClose: (() => void) | null = null;

function waitForServer(port: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  const check = (): Promise<boolean> =>
    new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/`, { timeout: 2000 }, () => resolve(true));
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) resolve(false);
        else setTimeout(() => check().then(resolve), 150);
      });
    });
  return check();
}

/**
 * Start the Next.js standalone server inside this process (no separate Node spawn).
 * Same pattern as many Electron + local-server apps: one process, server runs in main.
 */
async function startInProcessServer(): Promise<string> {
  const resourcesPath = process.resourcesPath;
  const userData = app.getPath("userData");
  logLine(`resourcesPath=${resourcesPath} userData=${userData}`);

  const appDir = path.join(resourcesPath, "app", "packages", "ui");
  const fallbackAppDir = path.join(resourcesPath, "app");
  const serverPath = fs.existsSync(path.join(appDir, "server.js"))
    ? path.join(appDir, "server.js")
    : path.join(fallbackAppDir, "server.js");

  if (!fs.existsSync(serverPath)) {
    logLine(`Bundled server not found at ${serverPath}`);
    return errorPageDataUrl(path.join(userData, "agentron-desktop.log"));
  }

  const port = await findAvailablePort();
  logLine(`Using port ${port} for bundled server (3000 left free for dev)`);
  process.env.PORT = String(port);
  process.env.HOSTNAME = "127.0.0.1";
  process.env.AGENTRON_DATA_DIR = userData;
  process.env.AGENTRON_APP_VERSION = app.getVersion();

  const origCwd = process.cwd();
  const origExit = process.exit;
  (process as NodeJS.Process).exit = ((code?: number) => {
    logLine(`Server called process.exit(${code ?? "undefined"})`);
  }) as typeof process.exit;

  try {
    require(serverPath);
  } finally {
    process.chdir(origCwd);
    (process as NodeJS.Process).exit = origExit;
  }

  const ready = await waitForServer(port, SERVER_WAIT_MS);
  if (ready) {
    logLine("Server ready");
    return `http://127.0.0.1:${port}`;
  }
  logLine("Server wait timeout");
  return errorPageDataUrl(path.join(userData, "agentron-desktop.log"));
}

app.whenReady().then(async () => {
  logLine("app.whenReady");
  try {
    const adapter = initializeLocalRuntime();
    runtimeClose = () => adapter.close();
  } catch (err) {
    logLine(`Local runtime unavailable: ${(err as Error).message}`);
  }

  let url: string;
  if (app.isPackaged) {
    url = await startInProcessServer();
  } else {
    url = process.env.AGENTRON_STUDIO_URL ?? `http://localhost:${DEV_PORT}`;
  }

  createWindow(url);
}).catch((err) => {
  logLine(`whenReady failed: ${err}`);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  runtimeClose?.();
});
