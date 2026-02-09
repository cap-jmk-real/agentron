import { json } from "../../../_lib/response";
import { db, customFunctions, sandboxes, fromCustomFunctionRow, fromSandboxRow } from "../../../_lib/db";
import { eq } from "drizzle-orm";
import { PodmanManager } from "@agentron-studio/runtime";

export const runtime = "nodejs";

const podman = new PodmanManager();

type Params = { params: { id: string } };

export async function POST(request: Request, { params }: Params) {
  const fnRows = await db.select().from(customFunctions).where(eq(customFunctions.id, params.id));
  if (fnRows.length === 0) return json({ error: "Function not found" }, { status: 404 });

  const fn = fromCustomFunctionRow(fnRows[0]);
  const payload = await request.json();
  const input = payload.input;

  // Find or require a sandbox
  let containerId: string | undefined;

  if (fn.sandboxId) {
    const sbRows = await db.select().from(sandboxes).where(eq(sandboxes.id, fn.sandboxId));
    if (sbRows.length > 0) {
      const sb = fromSandboxRow(sbRows[0]);
      containerId = sb.containerId ?? undefined;
    }
  }

  if (!containerId) {
    return json({ error: "No sandbox assigned to this function. Create a sandbox first." }, { status: 400 });
  }

  // Build execution command based on language
  let command: string;
  const inputJson = JSON.stringify(input ?? null);

  switch (fn.language) {
    case "python":
      command = `python3 -c ${JSON.stringify(fn.source + `\nif __name__=="__main__": import json,sys; print(json.dumps(main(json.loads(sys.argv[1] if len(sys.argv)>1 else 'null'))))`)} ${JSON.stringify(inputJson)}`;
      break;
    case "javascript":
    case "typescript":
      command = `node -e ${JSON.stringify(`const input = ${inputJson}; ${fn.source}; if(typeof main==='function') main(input).then(r=>console.log(JSON.stringify(r))).catch(e=>console.error(e));`)}`;
      break;
    default:
      command = `echo "Unsupported language: ${fn.language}"`;
  }

  try {
    const result = await podman.exec(containerId, command);
    return json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, { status: 500 });
  }
}
