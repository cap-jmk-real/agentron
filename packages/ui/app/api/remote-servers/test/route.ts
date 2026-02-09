import { json } from "../../_lib/response";
import { testRemoteConnection } from "../../_lib/remote-test";

export const runtime = "nodejs";

/**
 * POST body: { host, port?, user, authType: "key"|"password", keyPath? }
 * Returns { ok, message, guidance? }
 */
export async function POST(request: Request) {
  const body = await request.json();
  const host = body.host as string;
  const user = body.user as string;
  if (!host || !user) {
    return json({ ok: false, message: "host and user are required" });
  }
  const result = await testRemoteConnection({
    host,
    port: body.port,
    user,
    authType: body.authType as string,
    keyPath: body.keyPath as string | undefined,
  });
  return json(result);
}
