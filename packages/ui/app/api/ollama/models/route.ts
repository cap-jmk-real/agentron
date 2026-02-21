import { json } from "../../_lib/response";

export const runtime = "nodejs";

export async function GET() {
  try {
    const res = await fetch("http://localhost:11434/api/tags", {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return json({ error: "Ollama not responding" }, { status: 502 });

    const data = (await res.json()) as {
      models?: Array<{
        name: string;
        size: number;
        digest: string;
        modified_at: string;
        details?: {
          parameter_size?: string;
          quantization_level?: string;
          family?: string;
          format?: string;
        };
      }>;
    };

    const models = (data.models ?? []).map((m) => ({
      name: m.name,
      size: m.size,
      digest: m.digest?.slice(0, 12),
      modifiedAt: m.modified_at,
      parameterSize: m.details?.parameter_size,
      quantization: m.details?.quantization_level,
      family: m.details?.family,
      format: m.details?.format,
    }));

    // Also get running models
    let running: Array<{ name: string; size: number; sizeVram: number }> = [];
    try {
      const psRes = await fetch("http://localhost:11434/api/ps", {
        signal: AbortSignal.timeout(3000),
      });
      if (psRes.ok) {
        const psData = (await psRes.json()) as {
          models?: Array<{ name: string; size: number; size_vram: number }>;
        };
        running = (psData.models ?? []).map((m) => ({
          name: m.name,
          size: m.size,
          sizeVram: m.size_vram,
        }));
      }
    } catch {
      /* ignore */
    }

    return json({ models, running });
  } catch {
    return json({ error: "Cannot connect to Ollama" }, { status: 502 });
  }
}
