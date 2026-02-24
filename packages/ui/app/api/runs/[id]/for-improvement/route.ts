import { json } from "../../../_lib/response";
import { getRunForImprovement } from "../../../_lib/run-for-improvement";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const includeFullLogs = url.searchParams.get("includeFullLogs") === "true";
  const result = await getRunForImprovement(id, { includeFullLogs });
  if ("error" in result) {
    return json(result, { status: 404 });
  }
  return json(result);
}
