import { json } from "../../_lib/response";
import { openclawStatus } from "../../_lib/openclaw-client";

export const runtime = "nodejs";

export async function GET() {
  try {
    const status = await openclawStatus();
    return json(status);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: message }, { status: 502 });
  }
}
