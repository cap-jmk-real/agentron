import { db, sandboxSiteBindings, fromSandboxSiteBindingRow } from "../../_lib/db";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

const BACKEND_HOST = process.env.SANDBOX_BACKEND_HOST ?? "127.0.0.1";

type Params = { params: Promise<{ path?: string[] }> };

export async function GET(request: Request, { params }: Params) {
  return proxy(request, await params);
}

export async function POST(request: Request, { params }: Params) {
  return proxy(request, await params);
}

export async function PUT(request: Request, { params }: Params) {
  return proxy(request, await params);
}

export async function PATCH(request: Request, { params }: Params) {
  return proxy(request, await params);
}

export async function DELETE(request: Request, { params }: Params) {
  return proxy(request, await params);
}

export async function HEAD(request: Request, { params }: Params) {
  return proxy(request, await params);
}

async function proxy(request: Request, params: { path?: string[] }) {
  const host = request.headers.get("x-sandbox-host");
  if (!host) {
    return new Response("Missing X-Sandbox-Host header", { status: 400 });
  }
  const rows = await db
    .select()
    .from(sandboxSiteBindings)
    .where(eq(sandboxSiteBindings.host, host.toLowerCase().trim()));
  if (rows.length === 0) {
    return new Response("No binding for this host", { status: 404 });
  }
  const binding = fromSandboxSiteBindingRow(rows[0]);
  const pathSegments = params.path ?? [];
  const pathname = "/" + pathSegments.join("/");
  const url = new URL(request.url);
  const targetUrl = `http://${BACKEND_HOST}:${binding.hostPort}${pathname}${url.search}`;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === "host" || lower === "connection" || lower === "x-sandbox-host") return;
    headers.set(key, value);
  });
  headers.set("Host", host);

  let body: BodyInit | undefined;
  if (request.method !== "GET" && request.method !== "HEAD" && request.body) {
    body = request.body;
  }

  try {
    const res = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
      duplex: "half",
    } as RequestInit);
    const resHeaders = new Headers();
    res.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (lower === "transfer-encoding" || lower === "connection") return;
      resHeaders.set(key, value);
    });
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: resHeaders,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(`Proxy error: ${message}`, { status: 502 });
  }
}
