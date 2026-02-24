/**
 * Start a dedicated Chrome instance for browser automation (CDP on 127.0.0.1:9222)
 * if nothing is listening yet. Uses a separate user-data-dir so the user's normal
 * Chrome can stay open. Called from main when the Electron app is ready.
 */
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const PORT = 9222;
const HOST = "127.0.0.1";

function portOpen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function getChromePath(): string {
  const platform = process.platform;
  if (platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }
  if (platform === "win32") {
    const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
    return path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe");
  }
  return "google-chrome";
}

export function launchChromeForAutomation(): void {
  if (
    process.platform !== "darwin" &&
    process.platform !== "win32" &&
    process.platform !== "linux"
  ) {
    return;
  }
  const chromePath = getChromePath();
  if (process.platform !== "win32" && !existsSync(chromePath)) {
    return;
  }
  const userDataDir = path.join(os.tmpdir(), "agentron");
  try {
    mkdirSync(userDataDir, { recursive: true });
  } catch {
    return;
  }
  const child = spawn(
    chromePath,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { detached: true, stdio: "ignore" }
  );
  child.on("error", () => {});
  child.unref();
}

export async function ensureChromeAutomation(): Promise<void> {
  if (await portOpen(HOST, PORT)) {
    return;
  }
  launchChromeForAutomation();
}
