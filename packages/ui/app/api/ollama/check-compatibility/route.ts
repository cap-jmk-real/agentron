import { json } from "../../_lib/response";
import { checkCompatibility } from "@agentron-studio/runtime";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json();
  const parameterSize = (body.parameterSize as string) ?? "7B";

  const result = await checkCompatibility(parameterSize);
  return json(result);
}
