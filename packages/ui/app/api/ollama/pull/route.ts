import { checkCompatibility } from "@agentron-studio/runtime";

export const runtime = "nodejs";

/**
 * Stream Ollama model pull progress.
 * POST body: { model: string }
 * Returns NDJSON stream of progress events.
 */
export async function POST(request: Request) {
  const body = await request.json();
  const model = body.model as string;
  const parameterSize = (body.parameterSize as string) ?? "7B";

  if (!model) {
    return new Response(JSON.stringify({ error: "model required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Run compatibility check
  const compat = await checkCompatibility(parameterSize);

  try {
    const ollamaRes = await fetch("http://localhost:11434/api/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: model, stream: true }),
    });

    if (!ollamaRes.ok || !ollamaRes.body) {
      const text = await ollamaRes.text();
      return new Response(JSON.stringify({ error: text }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Create a transform stream that prepends compatibility info
    const reader = ollamaRes.body.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        // Send compatibility info first
        controller.enqueue(
          encoder.encode(JSON.stringify({ type: "compatibility", ...compat }) + "\n")
        );

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          // Forward Ollama's NDJSON lines
          for (const line of text.split("\n").filter(Boolean)) {
            try {
              const parsed = JSON.parse(line);
              controller.enqueue(
                encoder.encode(JSON.stringify({ type: "progress", ...parsed }) + "\n")
              );
            } catch {
              controller.enqueue(
                encoder.encode(JSON.stringify({ type: "raw", data: line }) + "\n")
              );
            }
          }
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Cannot connect to Ollama" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
