import { json } from "../../_lib/response";
import { configureOllamaForContainers } from "../../_lib/ollama-configure-for-containers";

export const runtime = "nodejs";

/**
 * POST: Configure Ollama so it is reachable from containers (set OLLAMA_HOST=0.0.0.0 and restart).
 * Call when the app or e2e detects that host Ollama is up but containers cannot reach it.
 */
export async function POST() {
  const result = await configureOllamaForContainers();
  if (result.ok) {
    return json({ ok: true, message: "Ollama restarted with OLLAMA_HOST=0.0.0.0" });
  }
  return json({ ok: false, error: result.error }, { status: 500 });
}
