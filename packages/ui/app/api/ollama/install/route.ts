import { json } from "../../_lib/response";
import { getSystemResources } from "@agentron-studio/runtime";
import { spawn } from "node:child_process";

export const runtime = "nodejs";

const OLLAMA_DOWNLOAD_URL = "https://ollama.com/download";

/** Start Ollama install: 'download' returns URL to open; 'brew' runs brew install ollama and streams output. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const method = (body.method as string) || "download";

  if (method === "download") {
    return json({ openUrl: OLLAMA_DOWNLOAD_URL });
  }

  if (method === "brew") {
    const system = await getSystemResources();
    if (system.platform !== "darwin") {
      return json({ error: "Homebrew install is only supported on macOS." }, { status: 400 });
    }

    const child = spawn("brew", ["install", "ollama"], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        const write = (chunk: Buffer | string) => {
          controller.enqueue(enc.encode(chunk.toString()));
        };
        child.stdout?.on("data", write);
        child.stderr?.on("data", write);
        child.on("close", (code) => {
          if (code === 0) {
            controller.enqueue(enc.encode("\n\nInstall complete. Starting Ollama...\n"));
            const serve = spawn("ollama", ["serve"], {
              stdio: "ignore",
              detached: true,
              env: { ...process.env },
            });
            serve.unref();
          }
          controller.close();
        });
        child.on("error", (err) => {
          controller.enqueue(enc.encode(`Error: ${err.message}\n`));
          controller.close();
        });
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return json({ error: "Invalid method. Use 'download' or 'brew'." }, { status: 400 });
}
