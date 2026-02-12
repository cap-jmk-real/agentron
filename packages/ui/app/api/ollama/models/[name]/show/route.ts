import { json } from "../../../../_lib/response";

type Params = { params: Promise<{ name: string }> };

export const runtime = "nodejs";

export async function POST(_: Request, { params }: Params) {
  const { name } = await params;
  const modelName = decodeURIComponent(name);
  try {
    const res = await fetch("http://localhost:11434/api/show", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelName }),
    });
    if (!res.ok) return json({ error: "Model not found" }, { status: 404 });
    const data = await res.json();
    return json(data);
  } catch {
    return json({ error: "Cannot connect to Ollama" }, { status: 502 });
  }
}
