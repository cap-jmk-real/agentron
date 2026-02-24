import { json } from "../../_lib/response";
import { clearOne, clearBulk, clearAll } from "../../_lib/notifications-store";
import type { NotificationType } from "../../_lib/notifications-store";

export const runtime = "nodejs";

/** POST /api/notifications/clear — clear one, many by id, or all (optionally by type). Body: { id?: string, ids?: string[], types?: NotificationType[] }. */
export async function POST(request: Request) {
  let body: { id?: string; ids?: string[]; types?: NotificationType[] };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return json({ error: "Body must be an object" }, { status: 400 });
  }

  if (body.id != null) {
    const ok = await clearOne(typeof body.id === "string" ? body.id : "");
    return json({ cleared: ok ? 1 : 0 });
  }
  if (Array.isArray(body.ids) && body.ids.length > 0) {
    const ids = body.ids.filter((x): x is string => typeof x === "string");
    const cleared = await clearBulk(ids);
    return json({ cleared });
  }
  if (Array.isArray(body.types) && body.types.length > 0) {
    const cleared = await clearAll(body.types as NotificationType[]);
    return json({ cleared });
  }
  // Clear all active
  const cleared = await clearAll();
  return json({ cleared });
}
