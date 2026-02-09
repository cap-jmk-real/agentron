import { runReset } from "../../_lib/db";
import { json } from "../../_lib/response";

export const runtime = "nodejs";

/** Drop all tables and re-create from current schema. Clears all data so you can start fresh. */
export async function POST() {
  try {
    runReset();
    return json({ ok: true, message: "Database reset. All data cleared. Refresh the app." });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Reset failed";
    return json({ error: message }, { status: 500 });
  }
}
