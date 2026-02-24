import { json } from "../../_lib/response";
import { buildVaultClearCookieHeader } from "../../_lib/vault";

export const runtime = "nodejs";

/** POST /api/vault/lock — lock vault (clear cookie). */
export async function POST() {
  const cookieHeader = buildVaultClearCookieHeader();
  return json(
    { ok: true },
    {
      headers: { "Set-Cookie": cookieHeader },
    }
  );
}
