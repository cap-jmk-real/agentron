import { json } from "../../../_lib/response";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const source = url.searchParams.get("source") ?? "huggingface";

  if (!q) return json({ error: "q parameter required" }, { status: 400 });

  if (source === "huggingface") {
    try {
      const hfUrl = `https://huggingface.co/api/models?search=${encodeURIComponent(q)}&filter=text-generation&sort=downloads&direction=-1&limit=20`;
      const res = await fetch(hfUrl, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return json({ error: "HuggingFace API error" }, { status: 502 });

      const data = (await res.json()) as Array<{
        id: string;
        modelId?: string;
        downloads?: number;
        likes?: number;
        tags?: string[];
        siblings?: Array<{ rfilename: string }>;
      }>;

      const models = data.map((m) => {
        const hasGguf = (m.siblings ?? []).some((s) => s.rfilename.endsWith(".gguf"));
        return {
          id: m.id ?? m.modelId,
          name: m.id ?? m.modelId,
          downloads: m.downloads ?? 0,
          likes: m.likes ?? 0,
          tags: m.tags ?? [],
          hasGguf,
        };
      });

      return json(models);
    } catch {
      return json({ error: "Failed to reach HuggingFace" }, { status: 502 });
    }
  }

  return json({ error: `Unknown source: ${source}` }, { status: 400 });
}
