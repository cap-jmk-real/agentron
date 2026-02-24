import { json } from "../../_lib/response";
import { openclawHistory } from "../../_lib/openclaw-client";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionKey = searchParams.get("sessionKey") ?? undefined;
    const limitParam = searchParams.get("limit");
    const limit = limitParam != null ? parseInt(limitParam, 10) : undefined;
    const result = await openclawHistory({
      sessionKey,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, { status: 502 });
  }
}
