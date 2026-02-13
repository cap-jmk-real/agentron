import { json } from "../../_lib/response";
import { getLogDir, getLogPath, getLogExcerpt, probeLogWritable } from "../../_lib/api-logger";

export const runtime = "nodejs";

/** Debug info for GitHub issues: data dir, version, log path, recent API error log. No secrets. */
export async function GET() {
  const dataDir = getLogDir();
  const logPath = getLogPath();
  const version = process.env.AGENTRON_APP_VERSION ?? process.env.npm_package_version ?? "";
  const logWritable = probeLogWritable();
  const logExcerpt = getLogExcerpt(100);
  return json({
    dataDir,
    logPath,
    version,
    logWritable,
    logExcerpt,
    userAgent: "", // client can send if needed
  });
}
