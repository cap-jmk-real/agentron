import { json } from "../_lib/response";

export const runtime = "nodejs";

export async function GET() {
  return json({ tools: [] });
}
