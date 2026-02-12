import { json } from "../../../_lib/response";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const source = url.searchParams.get("source") ?? "huggingface";

  if (!q) return json({ error: "q parameter required" }, { status: 400 });

  if (source === "huggingface") {
    try {
      const hfUrl = `https://huggingface.co/api/models?search=${encodeURIComponent(q)}&filter=text-generation-inference&sort=downloads&direction=-1&limit=20`;
      const res = await fetch(hfUrl, {
        signal: AbortSignal.timeout(15000),
        headers: {
          "Accept": "application/json",
          "User-Agent": "Agentron/1.0 (https://github.com/agentron; app)",
        },
      });
      if (!res.ok) {
        const text = await res.text();
        return json({ error: `HuggingFace API error: ${res.status}`, details: text.slice(0, 200) }, { status: 502 });
      }

      const data = (await res.json()) as Array<{
        id: string;
        modelId?: string;
        downloads?: number;
        likes?: number;
        tags?: string[];
        siblings?: Array<{ rfilename: string }>;
      }>;

      const PARAM_SIZES = ["405B", "70B", "32B", "14B", "13B", "8B", "7B", "3B", "1B"] as const;
      const inferParameterSize = (modelId: string, tags: string[]): string | undefined => {
        const combined = `${modelId} ${(tags ?? []).join(" ")}`.toLowerCase();
        return PARAM_SIZES.find((s) => combined.includes(s.toLowerCase()));
      };

      const models = data.map((m) => {
        const id = m.id ?? m.modelId ?? "";
        const hasGguf = (m.siblings ?? []).some((s) => s.rfilename.endsWith(".gguf"));
        const parameterSize = inferParameterSize(id, m.tags ?? []);
        return {
          id,
          name: id,
          downloads: m.downloads ?? 0,
          likes: m.likes ?? 0,
          tags: m.tags ?? [],
          hasGguf,
          parameterSize: parameterSize ?? undefined,
        };
      });

      return json(models);
    } catch {
      return json({ error: "Failed to reach HuggingFace" }, { status: 502 });
    }
  }

  return json({ error: `Unknown source: ${source}` }, { status: 400 });
}
