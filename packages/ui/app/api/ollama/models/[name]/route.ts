import { json } from "../../../_lib/response";

type Params = { params: { name: string } };

export const runtime = "nodejs";

export async function DELETE(_: Request, { params }: Params) {
  const modelName = decodeURIComponent(params.name);
  try {
    const res = await fetch("http://localhost:11434/api/delete", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName }),
    });
    if (!res.ok) {
      const text = await res.text();
      return json({ error: text }, { status: res.status });
    }
    return json({ ok: true, message: `Model ${modelName} deleted` });
  } catch {
    return json({ error: "Cannot connect to Ollama" }, { status: 502 });
  }
}
