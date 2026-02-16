#!/usr/bin/env node
/**
 * Start a dedicated Chrome instance for browser automation (CDP on 127.0.0.1:9222).
 * Uses a separate user-data-dir so your normal Chrome can stay open.
 * Used by: npm run dev:ui (before Next dev server) and by the Electron app when packaged.
 * If something is already listening on 9222, this script exits without starting another Chrome.
 */
const { spawn } = require("node:child_process");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const PORT = 9222;
const HOST = "127.0.0.1";
const WAIT_MS = 12000;

function portOpen(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port }, () => {
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

function getChromePath() {
  const platform = process.platform;
  if (platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }
  if (platform === "win32") {
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    return path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe");
  }
  return "google-chrome";
}

function launchChrome() {
  const chromePath = getChromePath();
  const userDataDir = path.join(os.tmpdir(), "agentron");
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
  } catch {
    process.exit(1);
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
  child.on("error", () => process.exit(1));
  child.unref();
}

async function main() {
  if (await portOpen(HOST, PORT)) {
    return;
  }
  launchChrome();
  const start = Date.now();
  while (Date.now() - start < WAIT_MS) {
    if (await portOpen(HOST, PORT)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
}

main().catch(() => process.exit(1));
