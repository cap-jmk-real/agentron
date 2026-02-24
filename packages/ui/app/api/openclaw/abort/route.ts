import { json } from "../../_lib/response";
import { openclawAbort } from "../../_lib/openclaw-client";

export const runtime = "nodejs";

type Body = { sessionKey?: string };

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Body;
    const sessionKey = typeof body?.sessionKey === "string" ? body.sessionKey : undefined;
    const result = await openclawAbort({ sessionKey });
    return json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: message }, { status: 502 });
  }
}
