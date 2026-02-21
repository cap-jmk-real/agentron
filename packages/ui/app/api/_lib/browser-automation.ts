/**
 * Browser automation via CDP (Chrome DevTools Protocol).
 * Connect to Chrome at 127.0.0.1:9222. If nothing is listening, we try once to launch
 * a dedicated Chrome (separate user-data-dir) so the user's normal Chrome can stay open.
 */
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { BrowserAutomationOutput } from "@agentron-studio/runtime/browser-automation";

const DEFAULT_CDP_URL = "http://127.0.0.1:9222";
const DEFAULT_CDP_PORT = 9222;
const DEFAULT_TIMEOUT_MS = 30000;
const LAUNCH_WAIT_MS = 12000;
/** Minimum ms between interactive actions (navigate, click, fill) to avoid bot detection. ~20 actions/min at 3000ms. */
const DEFAULT_MIN_ACTION_INTERVAL_MS = 3000;

let launchAttempted = false;
/** Last time an interactive browser action completed (navigate, click, fill). Used for throttling. */
let lastInteractiveActionAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Message thrown when the run is cancelled so the workflow can set status to "cancelled". Must match RUN_CANCELLED_MESSAGE in run-workflow. */
const RUN_CANCELLED_MESSAGE = "Run cancelled by user";

/** Rejects when isCancelled() returns true. Polls every checkIntervalMs so long operations can exit when user clicks Stop. */
async function waitUntilCancelled(
  isCancelled: () => Promise<boolean>,
  checkIntervalMs: number = 1500
): Promise<never> {
  while (true) {
    await sleep(checkIntervalMs);
    if (await isCancelled()) throw new Error(RUN_CANCELLED_MESSAGE);
  }
}

/** Race a long operation with cancellation; when cancelled, throws so the run can stop. */
async function withCancellation<T>(
  promise: Promise<T>,
  isCancelled?: () => Promise<boolean>
): Promise<T> {
  if (!isCancelled) return promise;
  const result = await Promise.race([promise, waitUntilCancelled(isCancelled)]);
  return result as T;
}

/**
 * Enforces a minimum interval between interactive actions, with random jitter so delays
 * look more human (not fixed). Actual interval is base + random(0, 50% of base).
 */
async function throttleInteractiveAction(minIntervalMs: number): Promise<void> {
  if (minIntervalMs <= 0) return;
  const now = Date.now();
  const elapsed = now - lastInteractiveActionAt;
  const jitterMs = Math.floor(minIntervalMs * 0.5 * Math.random());
  const requiredIntervalMs = minIntervalMs + jitterMs;
  if (elapsed < requiredIntervalMs && lastInteractiveActionAt > 0) {
    await sleep(requiredIntervalMs - elapsed);
  }
}

function getChromePath(): string {
  if (process.platform === "darwin")
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (process.platform === "win32") {
    const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
    return path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe");
  }
  return "google-chrome";
}

function waitForPort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tryConnect = () => {
      const socket = createConnection({ host, port }, () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() >= deadline) resolve(false);
        else setTimeout(tryConnect, 300);
      });
    };
    tryConnect();
  });
}

async function tryLaunchChrome(): Promise<boolean> {
  if (launchAttempted) return false;
  // Skip launching Chrome in tests (e.g. AGENTRON_SKIP_CHROME_LAUNCH=1) to avoid leaving tabs open.
  if (process.env.AGENTRON_SKIP_CHROME_LAUNCH === "1") return false;
  launchAttempted = true;
  const userDataDir = path.join(os.tmpdir(), "agentron");
  try {
    await mkdir(userDataDir, { recursive: true });
  } catch {
    return false;
  }
  const child = spawn(
    getChromePath(),
    [
      `--remote-debugging-port=${DEFAULT_CDP_PORT}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { detached: true, stdio: "ignore" }
  );
  child.on("error", () => {});
  child.unref();
  return waitForPort("127.0.0.1", DEFAULT_CDP_PORT, LAUNCH_WAIT_MS);
}

async function getPage(cdpUrl: string) {
  const { chromium } = await import("playwright");
  const browser = await chromium.connectOverCDP(cdpUrl, { timeout: DEFAULT_TIMEOUT_MS });
  const contexts = browser.contexts();
  if (contexts.length === 0) {
    await browser.close();
    throw new Error("No browser context found. Open at least one tab in Chrome.");
  }
  const pages = contexts[0].pages();
  if (pages.length === 0) {
    await browser.close();
    throw new Error("No page/tab found. Open at least one tab in Chrome.");
  }
  return { page: pages[0], browser };
}

export type BrowserLogEntry = {
  level: "stdout" | "stderr";
  message: string;
  payload?: Record<string, unknown>;
};

export type BrowserAutomationContext = {
  /** When provided, long operations (navigate, click, fill, waitFor) are raced with this; when it returns true the tool exits so the run can stop. */
  isCancelled?: () => Promise<boolean>;
  /** When provided, run_logs-style entries are emitted after each action for debugging and "Copy for chat". */
  onLog?: (entry: BrowserLogEntry) => void;
};

export async function browserAutomation(
  input: unknown,
  context?: BrowserAutomationContext
): Promise<BrowserAutomationOutput> {
  if (input === null || typeof input !== "object") {
    return { success: false, error: "Input must be an object with action" };
  }
  const o = input as Record<string, unknown>;
  const action = typeof o.action === "string" ? o.action : "";
  const validActions = ["navigate", "click", "fill", "screenshot", "getContent", "waitFor"];
  if (!validActions.includes(action)) {
    return { success: false, error: `action must be one of: ${validActions.join(", ")}` };
  }

  const isCancelled = context?.isCancelled;
  const onLog = context?.onLog;

  const cdpUrl =
    typeof o.cdpUrl === "string" && o.cdpUrl.trim() ? o.cdpUrl.trim() : DEFAULT_CDP_URL;
  const timeout =
    typeof o.timeout === "number" && o.timeout > 0
      ? Math.min(o.timeout, 60000)
      : DEFAULT_TIMEOUT_MS;
  const minActionIntervalMs =
    typeof o.minActionIntervalMs === "number" && o.minActionIntervalMs >= 0
      ? Math.min(o.minActionIntervalMs, 60000)
      : DEFAULT_MIN_ACTION_INTERVAL_MS;
  const useDefaultCdp = cdpUrl === DEFAULT_CDP_URL;

  let browser: Awaited<ReturnType<typeof getPage>>["browser"] | undefined;
  try {
    let pageAndBrowser: Awaited<ReturnType<typeof getPage>>;
    try {
      pageAndBrowser = await withCancellation(getPage(cdpUrl), isCancelled);
    } catch (firstErr) {
      const isRefused = /ECONNREFUSED|connection refused/i.test(
        firstErr instanceof Error ? firstErr.message : String(firstErr)
      );
      if (useDefaultCdp && isRefused && (await tryLaunchChrome())) {
        pageAndBrowser = await withCancellation(getPage(cdpUrl), isCancelled);
      } else {
        throw firstErr;
      }
    }
    const { page, browser: b } = pageAndBrowser;
    browser = b;
    page.setDefaultTimeout(timeout);

    switch (action) {
      case "navigate": {
        await throttleInteractiveAction(minActionIntervalMs);
        const url = typeof o.url === "string" ? o.url.trim() : "";
        if (!url) return { success: false, error: "url is required for action navigate" };
        try {
          await withCancellation(
            page.goto(url, { waitUntil: "domcontentloaded", timeout }),
            isCancelled
          );
        } catch (navErr) {
          const navMsg = navErr instanceof Error ? navErr.message : String(navErr);
          onLog?.({
            level: "stderr",
            message: `[Playwright] navigate failed — ${navMsg}`,
            payload: { source: "playwright", action: "navigate", url, error: navMsg },
          });
          const urlHint =
            " If the URL is wrong or unreachable, use web search (e.g. std-web-search or DuckDuckGo) to find the correct URL, then retry navigate.";
          return { success: false, error: navMsg + urlHint };
        }
        lastInteractiveActionAt = Date.now();
        const finalUrl = page.url();
        const pageTitle = await page.title().catch(() => "");
        onLog?.({
          level: "stdout",
          message: "[Playwright] navigate completed",
          payload: {
            source: "playwright",
            action: "navigate",
            requestedUrl: url,
            finalUrl,
            pageTitle,
          },
        });
        const content = await page.content();
        return { success: true, content: content.slice(0, 100_000) };
      }
      case "getContent": {
        const content = await page.content();
        const body = await page.locator("body").first();
        const text = await body.innerText().catch(() => "");
        const snippet = text.slice(0, 50_000) || content.slice(0, 50_000);
        const snippetPreview = snippet.slice(0, 300).replace(/\s+/g, " ").trim();
        const hasKnownErrorPage = /sorry[, ]*we couldn't find that page|404|not found/i.test(
          snippet
        );
        onLog?.({
          level: "stdout",
          message: "[Playwright] getContent",
          payload: {
            source: "playwright",
            action: "getContent",
            contentLength: snippet.length,
            snippetPreview: snippetPreview
              ? snippetPreview + (snippet.length > 300 ? "…" : "")
              : undefined,
            hasKnownErrorPage,
          },
        });
        return { success: true, content: snippet };
      }
      case "click": {
        await throttleInteractiveAction(minActionIntervalMs);
        const selector = typeof o.selector === "string" ? o.selector.trim() : "";
        if (!selector) return { success: false, error: "selector is required for action click" };
        try {
          await withCancellation(page.click(selector, { timeout }), isCancelled);
          lastInteractiveActionAt = Date.now();
          onLog?.({
            level: "stdout",
            message: "[Playwright] click",
            payload: {
              source: "playwright",
              action: "click",
              selector: selector.slice(0, 80),
              outcome: "found and clicked",
            },
          });
          return { success: true };
        } catch (clickErr) {
          const msg = clickErr instanceof Error ? clickErr.message : String(clickErr);
          onLog?.({
            level: "stderr",
            message: `[Playwright] click failed — ${msg}`,
            payload: {
              source: "playwright",
              action: "click",
              selector: selector.slice(0, 80),
              error: msg,
            },
          });
          throw clickErr;
        }
      }
      case "fill": {
        await throttleInteractiveAction(minActionIntervalMs);
        const selector = typeof o.selector === "string" ? o.selector.trim() : "";
        const value = typeof o.value === "string" ? o.value : String(o.value ?? "");
        if (!selector) return { success: false, error: "selector is required for action fill" };
        try {
          await withCancellation(page.fill(selector, value, { timeout }), isCancelled);
          lastInteractiveActionAt = Date.now();
          onLog?.({
            level: "stdout",
            message: "[Playwright] fill",
            payload: {
              source: "playwright",
              action: "fill",
              selector: selector.slice(0, 80),
              valueLen: value.length,
              outcome: "filled",
            },
          });
          return { success: true };
        } catch (fillErr) {
          const msg = fillErr instanceof Error ? fillErr.message : String(fillErr);
          onLog?.({
            level: "stderr",
            message: `[Playwright] fill failed — ${msg}`,
            payload: {
              source: "playwright",
              action: "fill",
              selector: selector.slice(0, 80),
              error: msg,
            },
          });
          throw fillErr;
        }
      }
      case "screenshot": {
        const buffer = await page.screenshot({ type: "png", fullPage: false });
        const base64 = buffer.toString("base64");
        onLog?.({
          level: "stdout",
          message: "[Playwright] screenshot",
          payload: { source: "playwright", action: "screenshot", bytes: buffer.length },
        });
        return { success: true, screenshot: `data:image/png;base64,${base64}` };
      }
      case "waitFor": {
        const selector = typeof o.selector === "string" ? o.selector.trim() : "";
        if (!selector) return { success: false, error: "selector is required for action waitFor" };
        try {
          await withCancellation(
            page.waitForSelector(selector, { state: "visible", timeout }),
            isCancelled
          );
          onLog?.({
            level: "stdout",
            message: "[Playwright] waitFor",
            payload: {
              source: "playwright",
              action: "waitFor",
              selector: selector.slice(0, 80),
              outcome: "visible",
            },
          });
          return { success: true };
        } catch (waitErr) {
          const msg = waitErr instanceof Error ? waitErr.message : String(waitErr);
          onLog?.({
            level: "stderr",
            message: `[Playwright] waitFor failed — ${msg}`,
            payload: {
              source: "playwright",
              action: "waitFor",
              selector: selector.slice(0, 80),
              error: msg,
            },
          });
          throw waitErr;
        }
      }
      default:
        return { success: false, error: `Unhandled action: ${action}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isRefused = /ECONNREFUSED|connection refused/i.test(message);
    const hint =
      cdpUrl === DEFAULT_CDP_URL && isRefused
        ? " Chrome could not be started automatically. Start it manually: chrome --remote-debugging-port=9222 --user-data-dir=/tmp/agentron (so your normal Chrome can stay open)."
        : cdpUrl === DEFAULT_CDP_URL
          ? " Start Chrome with: chrome --remote-debugging-port=9222 on the same machine that runs the workflow."
          : "";
    return { success: false, error: message + (hint ? " " + hint : "") };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
    }
  }
}
