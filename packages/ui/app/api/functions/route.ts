import { json } from "../_lib/response";
import {
  db,
  customFunctions,
  toCustomFunctionRow,
  fromCustomFunctionRow,
  tools,
  toToolRow,
} from "../_lib/db";

export const runtime = "nodejs";

export async function GET() {
  const rows = await db.select().from(customFunctions);
  return json(rows.map(fromCustomFunctionRow));
}

export async function POST(request: Request) {
  const payload = await request.json();
  const id = payload.id ?? crypto.randomUUID();
  const fn = {
    id,
    name: payload.name,
    description: payload.description ?? undefined,
    language: payload.language ?? "javascript",
    source: payload.source ?? "",
    sandboxId: payload.sandboxId ?? undefined,
    createdAt: Date.now(),
  };

  await db.insert(customFunctions).values(toCustomFunctionRow(fn)).run();

  // Auto-register as a native tool so agents can call it
  const tool = {
    id: `fn-${id}`,
    name: fn.name,
    protocol: "native" as const,
    config: { functionId: id, language: fn.language },
    inputSchema: undefined,
    outputSchema: undefined,
  };
  await db.insert(tools).values(toToolRow(tool)).run();

  return json({ ...fn, toolId: tool.id }, { status: 201 });
}
