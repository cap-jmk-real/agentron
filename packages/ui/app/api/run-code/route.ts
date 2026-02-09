import { json } from "../_lib/response";
import { db, sandboxes, fromSandboxRow, toSandboxRow } from "../_lib/db";
import { eq } from "drizzle-orm";
import { PodmanManager } from "@agentron-studio/runtime";

export const runtime = "nodejs";

const podman = new PodmanManager();

const RUNNER_NODE_NAME = "agentos-runner-node";
const RUNNER_PYTHON_NAME = "agentos-runner-python";
const RUNNER_NODE_IMAGE = "node:22-slim";
const RUNNER_PYTHON_IMAGE = "python:3.12-slim";

async function ensureRunnerSandbox(name: string, image: string): Promise<string> {
  const rows = await db.select().from(sandboxes).where(eq(sandboxes.name, name)).limit(1);
  if (rows.length > 0) {
    const sb = fromSandboxRow(rows[0]);
    if (sb.containerId && sb.status === "running") return sb.containerId;
    const newContainerId = await podman.create(image, `${name}-${sb.id}`, { network: true });
    await db.update(sandboxes).set({ status: "running", containerId: newContainerId }).where(eq(sandboxes.id, sb.id)).run();
    return newContainerId;
  }
  const id = `runner-${name}-${Date.now()}`;
  const containerId = await podman.create(image, `${name}-${id}`, { network: true });
  await db.insert(sandboxes).values(toSandboxRow({
    id,
    name,
    image,
    status: "running",
    containerId,
    config: {},
    createdAt: Date.now(),
  })).run();
  return containerId;
}

/** Run arbitrary JavaScript or Python code. Uses long-lived runner sandboxes. */
export async function POST(request: Request) {
  let body: { language?: string; code?: string; input?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }
  const language = (body.language ?? "javascript").toLowerCase();
  const code = typeof body.code === "string" ? body.code : "";
  const input = body.input;

  if (!code.trim()) {
    return json({ error: "code is required" }, { status: 400 });
  }

  const inputJson = JSON.stringify(input ?? null);
  let containerId: string;
  let command: string;

  if (language === "python") {
    containerId = await ensureRunnerSandbox(RUNNER_PYTHON_NAME, RUNNER_PYTHON_IMAGE);
    const codeB64 = Buffer.from(code, "utf8").toString("base64");
    const inputB64 = Buffer.from(inputJson, "utf8").toString("base64");
    command = `python3 -c "
import base64, json, sys
code = base64.b64decode(sys.argv[1]).decode()
inp = json.loads(base64.b64decode(sys.argv[2]).decode())
exec(code)
if 'main' in dir() and callable(main):
    out = main(inp)
    print(json.dumps(out) if out is not None else 'null')
else:
    print(json.dumps({'output': 'No main() defined'}))
" '${codeB64}' '${inputB64}'`;
  } else {
    containerId = await ensureRunnerSandbox(RUNNER_NODE_NAME, RUNNER_NODE_IMAGE);
    const codeWithInput = `const input = ${inputJson}; ${code}; typeof main === 'function' ? main(input).then(r => console.log(JSON.stringify(r))).catch(e => { console.error(e); process.exit(1); }) : console.log(JSON.stringify({ output: 'No main() defined' }));`;
    command = `node -e ${JSON.stringify(codeWithInput)}`;
  }

  try {
    const result = await podman.exec(containerId, command);
    let output: unknown = null;
    if (result.stdout.trim()) {
      try {
        output = JSON.parse(result.stdout.trim());
      } catch {
        output = { stdout: result.stdout, stderr: result.stderr };
      }
    }
    if (result.exitCode !== 0) {
      return json({
        error: result.stderr || "Execution failed",
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      }, { status: 500 });
    }
    return json({ output, stdout: result.stdout, stderr: result.stderr });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, { status: 500 });
  }
}
