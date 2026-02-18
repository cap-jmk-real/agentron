import { json } from "../../_lib/response";
import { getFeedbackForScope } from "../../_lib/feedback-for-scope";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const targetId = url.searchParams.get("targetId");
  const label = url.searchParams.get("label");
  const limitParam = url.searchParams.get("limit");

  if (!targetId || !targetId.trim()) {
    return json({ error: "targetId is required" }, { status: 400 });
  }

  const limit =
    limitParam != null && limitParam !== ""
      ? Number.isNaN(Number(limitParam))
        ? undefined
        : Number(limitParam)
      : undefined;

  const items = await getFeedbackForScope(targetId.trim(), {
    label: label && label.trim() ? (label.trim() as "good" | "bad") : undefined,
    limit,
  });

  return json(items);
}

