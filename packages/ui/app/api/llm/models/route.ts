import { json } from "../../_lib/response";
import { getModelsForProvider } from "@agentron-studio/runtime";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider") ?? "";

  let models = getModelsForProvider(provider);

  // For local/Ollama, also try to get installed models
  if (provider === "local") {
    try {
      const res = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = (await res.json()) as { models?: Array<{ name: string; size: number; details?: { parameter_size?: string } }> };
        const catalogById = new Map(models.map((m) => [m.id, m]));
        const installed = (data.models ?? []).map((m) => {
          const catalog = catalogById.get(m.name) ?? [...catalogById.values()].find((c) => m.name.startsWith(c.id.split(":")[0]));
          return {
            id: m.name,
            name: m.name,
            provider: "local",
            parameterSize: m.details?.parameter_size ?? catalog?.parameterSize,
            contextLength: catalog?.contextLength ?? 32768,
            installed: true,
          };
        });
        // Merge: mark catalog entries as installed if found, add any not in catalog
        const catalogIds = new Set(models.map((m) => m.id));
        const merged = models.map((m) => ({
          ...m,
          installed: installed.some((i) => i.id === m.id || i.id.startsWith(m.id.split(":")[0])),
        }));
        for (const inst of installed) {
          if (!catalogIds.has(inst.id)) {
            merged.push({ ...inst, contextLength: inst.contextLength ?? 32768 });
          }
        }
        return json(merged);
      }
    } catch {
      // Ollama not running, return catalog only
    }
  }

  return json(models);
}
