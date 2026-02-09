import { json } from "../../_lib/response";
import { getSystemResources } from "@agentron-studio/runtime";

export const runtime = "nodejs";

export async function GET() {
  const system = await getSystemResources();
  return json(system);
}
