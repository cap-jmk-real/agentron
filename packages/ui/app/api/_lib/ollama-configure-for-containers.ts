/**
 * Configure the local Ollama instance so it is reachable from containers (bind to 0.0.0.0).
 * Used once in e2e when the host has Ollama but the container probe fails, and from the app
 * when the user triggers "Fix Ollama for containers".
 *
 * Strategy: persist OLLAMA_HOST=0.0.0.0, stop any running Ollama, then start `ollama serve`
 * with OLLAMA_HOST=0.0.0.0 so it takes effect immediately.
 */

import { execSync, spawn } from "node:child_process";
import { platform } from "node:os";

const OLLAMA_HOST_VALUE = "0.0.0.0";

export type ConfigureOllamaResult = { ok: true } | { ok: false; error: string };

/**
 * Persist OLLAMA_HOST=0.0.0.0 for future sessions (Windows: setx; macOS: launchctl; Linux: skip and rely on current process).
 */
function persistOllamaHost(): void {
  const plat = platform();
  if (plat === "win32") {
    try {
      execSync(`setx OLLAMA_HOST ${OLLAMA_HOST_VALUE}`, {
        timeout: 5000,
        stdio: "pipe",
      });
    } catch {
      // setx can fail in some contexts; continue and start with env anyway
    }
    return;
  }
  if (plat === "darwin") {
    try {
      execSync(`launchctl setenv OLLAMA_HOST ${OLLAMA_HOST_VALUE}`, {
        timeout: 5000,
        stdio: "pipe",
      });
    } catch {
      // may fail if not in a GUI session
    }
    return;
  }
  // Linux: we don't persist here; the restarted process will use the env we pass
}

/**
 * Stop any running Ollama process so we can start it with OLLAMA_HOST.
 */
function stopOllama(): void {
  const plat = platform();
  try {
    if (plat === "win32") {
      execSync("taskkill /IM ollama.exe /F 2>nul", { timeout: 5000, stdio: "pipe" });
    } else {
      execSync("pkill -x ollama 2>/dev/null || true", {
        timeout: 5000,
        stdio: "pipe",
        shell: true,
      } as unknown as import("node:child_process").ExecSyncOptions);
    }
  } catch {
    // ignore
  }
}

/**
 * Start ollama serve with OLLAMA_HOST=0.0.0.0 in the background (detached, no shell window).
 */
function startOllamaServe(): void {
  const env = { ...process.env, OLLAMA_HOST: OLLAMA_HOST_VALUE };
  const plat = platform();
  const child = spawn("ollama", ["serve"], {
    env,
    detached: true,
    stdio: "ignore",
    ...(plat === "win32" && { windowsHide: true }),
  });
  child.unref();
}

/**
 * Wait until Ollama responds at localhost:11434 (up to timeoutMs).
 */
async function waitForOllama(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch("http://localhost:11434/api/tags", {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) return true;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

const OLLAMA_FIREWALL_RULE_NAME = "Ollama for containers (Agentron)";

/**
 * On Windows, try to allow inbound TCP 11434 so containers can reach host Ollama.
 * Requires elevated (admin) to succeed. Safe to call; logs and continues on failure.
 */
function tryAllowOllamaPortWindows(): void {
  if (platform() !== "win32") return;
  try {
    execSync(
      `netsh advfirewall firewall add rule name="${OLLAMA_FIREWALL_RULE_NAME}" dir=in action=allow protocol=TCP localport=11434`,
      { timeout: 5000, stdio: "pipe" }
    );
  } catch {
    // Often fails without admin; caller can re-probe and use sidecar or fail with clear message
  }
}

/**
 * Configure Ollama so it is reachable from containers: persist OLLAMA_HOST=0.0.0.0,
 * restart Ollama with that env, wait until it is up, and on Windows try to allow
 * inbound TCP 11434 (firewall). Safe to call when already configured.
 */
export async function configureOllamaForContainers(): Promise<ConfigureOllamaResult> {
  try {
    persistOllamaHost();
    stopOllama();
    await new Promise((r) => setTimeout(r, 2000));
    startOllamaServe();
    const up = await waitForOllama(30_000);
    if (!up) {
      return { ok: false, error: "Ollama did not start within 30s after restart" };
    }
    tryAllowOllamaPortWindows();
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
