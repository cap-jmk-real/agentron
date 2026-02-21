import { json } from "../../_lib/response";
import { openclawSend } from "../../_lib/openclaw-client";

export const runtime = "nodejs";

type Body = { content?: string; sessionKey?: string; waitForResponseMs?: number };

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const content = typeof body?.content === "string" ? body.content.trim() : "";
    if (!content) {
      return json({ error: "content is required" }, { status: 400 });
    }
    const result = await openclawSend(content, {
      sessionKey: typeof body?.sessionKey === "string" ? body.sessionKey : undefined,
      waitForResponseMs:
        typeof body?.waitForResponseMs === "number" ? body.waitForResponseMs : undefined,
    });
    return json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, { status: 502 });
  }
}
