import { json } from "../../_lib/response";

export const runtime = "nodejs";

export async function GET() {
  try {
    const res = await fetch("http://localhost:11434/api/version", {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json();
      return json({ running: true, version: data.version ?? "unknown" });
    }
    return json({ running: false, error: "Ollama not responding" });
  } catch {
    return json({ running: false, error: "Ollama not reachable at localhost:11434" });
  }
}
