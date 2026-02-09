import { json } from "../../../../_lib/response";
import { db, llmConfigs, fromLlmConfigRowWithSecret } from "../../../../_lib/db";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/**
 * GET OpenRouter key/limits for a provider.
 * Uses API key stored with the provider (never from env).
 * @see https://openrouter.ai/docs/api/reference/limits#rate-limits-and-credits-remaining
 */
export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db.select().from(llmConfigs).where(eq(llmConfigs.id, id));
  if (rows.length === 0) {
    return json({ error: "Provider not found" }, { status: 404 });
  }
  const config = fromLlmConfigRowWithSecret(rows[0]);
  if (config.provider !== "openrouter") {
    return json({ error: "Not an OpenRouter provider" }, { status: 400 });
  }

  const apiKey = typeof config.extra?.apiKey === "string" ? config.extra.apiKey : undefined;
  if (!apiKey) {
    return json({ error: "No API key set. Edit this provider and enter your OpenRouter API key." }, { status: 400 });
  }

  try {
    const res = await fetch("https://openrouter.ai/api/v1/key", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const text = await res.text();
      return json(
        { error: res.status === 401 ? "Invalid API key" : text || res.statusText },
        { status: res.status }
      );
    }
    const data = await res.json();
    return json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch key info";
    return json({ error: message }, { status: 502 });
  }
}
