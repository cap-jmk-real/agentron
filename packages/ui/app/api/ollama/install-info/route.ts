import { json } from "../../_lib/response";
import { getSystemResources } from "@agentron-studio/runtime";
import { execSync } from "node:child_process";

export const runtime = "nodejs";

const OLLAMA_DOWNLOAD_URL = "https://ollama.com/download";

/** Returns install URL and whether Homebrew install is available (macOS). */
export async function GET() {
  const system = await getSystemResources();
  const platform = system.platform;

  let canBrewInstall = false;
  if (platform === "darwin") {
    try {
      execSync("which brew", { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
      canBrewInstall = true;
    } catch {
      // brew not in PATH
    }
  }

  return json({
    installUrl: OLLAMA_DOWNLOAD_URL,
    platform,
    canBrewInstall,
  });
}
