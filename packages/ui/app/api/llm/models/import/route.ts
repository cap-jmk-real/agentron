import { json } from "../../../_lib/response";
import { execSync } from "node:child_process";

export const runtime = "nodejs";

/**
 * Import a model to Ollama from a HuggingFace GGUF file or model name.
 * POST body: { model: string, source: "huggingface" | "ollama" }
 */
export async function POST(request: Request) {
  const body = await request.json();
  const model = body.model as string;
  const source = (body.source as string) ?? "ollama";

  if (!model) return json({ error: "model required" }, { status: 400 });

  // Check if Ollama is available
  try {
    execSync("ollama --version", { timeout: 5000 });
  } catch {
    return json({ error: "Ollama is not installed or not in PATH" }, { status: 400 });
  }

  if (source === "huggingface") {
    // For HF models, we need a GGUF file. Create a Modelfile and use ollama create.
    // The model ID should be like "TheBloke/Llama-2-7B-GGUF"
    // Ollama supports pulling HF GGUF models directly in recent versions
    try {
      // Try to pull using ollama's HF support
      execSync(`ollama pull hf.co/${model}`, { timeout: 300000 });
      return json({ message: `Model ${model} imported from HuggingFace`, model });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return json(
        {
          error: `Failed to import from HuggingFace: ${msg}. The model may not have GGUF files available. Try using the HuggingFace Inference API instead.`,
        },
        { status: 400 }
      );
    }
  }

  // Standard Ollama pull
  try {
    execSync(`ollama pull ${model}`, { timeout: 300000 });
    return json({ message: `Model ${model} pulled successfully`, model });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: `Failed to pull model: ${msg}` }, { status: 500 });
  }
}
