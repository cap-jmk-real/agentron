# Sandbox site hosting (agent-hosted websites)

Agents can run web servers inside their Docker/Podman sandbox. You can bind a **domain or subdomain** to a sandbox so that traffic to that host is proxied to the container’s port. This works when Studio runs on a single host, in **Docker**, or behind **Kubernetes**.

## Overview

1. **Sandbox** runs a container with a web server (e.g. on port 80 or 8080 inside the container).
2. You create a **site binding**: host (e.g. `app.example.com`) + sandbox + container port. The system allocates a **host port** (e.g. 18100) and publishes the container port to that host port.
3. Incoming requests for that **host** are proxied to `hostPort` on the **backend host** (see below).
4. When Studio runs in Docker or K8s, you set **SANDBOX_BACKEND_HOST** so the proxy can reach the host (or node) where the sandbox ports are published.

## API

- **List bindings:** `GET /api/sandbox-site-bindings`  
  Returns all bindings. Use `?hosts=1` to get `{ hosts: string[] }` for reverse-proxy config.
- **List bindings for a sandbox:** `GET /api/sandbox/{sandboxId}/site-bindings`
- **Add binding:** `POST /api/sandbox/{sandboxId}/site-bindings`  
  Body: `{ "host": "app.example.com", "containerPort": 80 }`  
  The sandbox container is recreated with `network: true` and the new port published. If it was already running, it is recreated so the port mapping applies.

Port range for host ports: **SANDBOX_PORT_START** (default `18100`) to **SANDBOX_PORT_END** (default `18200`). Allocate more by increasing the end.

## Environment (Docker / K8s)

- **SANDBOX_BACKEND_HOST**  
  Hostname or IP the Studio app uses to reach the **host** where sandbox containers and their published ports run.  
  - **Same machine (default):** Omit or set to `127.0.0.1`.  
  - **Studio in Docker, Podman on host:** Set to `host.docker.internal` (Docker Desktop) or the host’s IP.  
  - **Kubernetes:** Set to the node IP or a service that routes to the node where the sandbox pod runs (see below).

- **SANDBOX_PORT_START** / **SANDBOX_PORT_END**  
  Range of host ports used for site bindings (default 18100–18200). Ensure this range is free on the host (or the node in K8s) and, in Docker/K8s, that it is published or reachable from the Studio pod.

## Routing a domain or subdomain

The Studio app does **not** accept requests by Host header on its own. You route a **domain/subdomain** to a sandbox in one of two ways.

### Option A: Reverse proxy in front of Studio (recommended)

Put **Caddy**, **Nginx**, **Traefik**, or your ingress in front of Studio. For each host that is bound to a sandbox:

1. Resolve the binding: `GET https://your-studio/api/sandbox-site-bindings?hosts=1` → `{ hosts: ["app.example.com"] }`.
2. For requests with `Host: app.example.com`, proxy to Studio and add the header so the internal proxy can forward to the sandbox:

**Caddy** (example):

```caddy
app.example.com {
  reverse_proxy http://studio:3000 {
    header_up X-Sandbox-Host {host}
    rewrite /api/sandbox-proxy{path}
  }
}
```

So a request to `https://app.example.com/foo` becomes a request to `http://studio:3000/api/sandbox-proxy/foo` with header `X-Sandbox-Host: app.example.com`. The Studio proxy route then looks up the binding for that host and forwards to `SANDBOX_BACKEND_HOST:hostPort`.

**Nginx** (concept):

- Use a map or `if` to set `$sandbox_host` when `$host` is one of your bound hosts.
- `proxy_pass http://studio:3000/api/sandbox-proxy$request_uri;`
- `proxy_set_header X-Sandbox-Host $host;`

**Kubernetes Ingress** (e.g. Ingress with a single host or multiple Ingresses per host):

- Annotate or configure the ingress so that for a specific host you proxy to the Studio service and add `X-Sandbox-Host`.
- Or run a small proxy sidecar/controller that calls `GET .../api/sandbox-site-bindings?hosts=1`, caches it, and rewrites requests for those hosts to `.../api/sandbox-proxy/...` with the header.

### Option B: Path-based (no domain routing)

If you don’t need a dedicated domain, you can expose the sandbox via a path and pass the host as a query param (if you add that to the proxy route), or use the internal proxy only for same-origin requests with a header. The default proxy route expects **X-Sandbox-Host**; it does not use the request’s Host header for lookup (so you need a reverse proxy or a client that sets the header).

## Summary

- **Bind a site:** `POST /api/sandbox/{id}/site-bindings` with `host` and `containerPort`. The sandbox gets a host port and is recreated with network + port mapping.
- **Docker:** Set **SANDBOX_BACKEND_HOST** to `host.docker.internal` (or host IP) so the proxy can reach the host’s ports.
- **K8s:** Set **SANDBOX_BACKEND_HOST** to the node/service that exposes the sandbox host ports; ensure the port range is available and reachable from the Studio pod.
- **Domain routing:** Put a reverse proxy in front of Studio and, for bound hosts, forward to `/api/sandbox-proxy{path}` with header **X-Sandbox-Host** set to the request host.
