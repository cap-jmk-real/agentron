# AgentOS Studio Architecture

This repo provides a standalone, local-first Studio application:

- Electron wrapper with a Next.js UI.
- Local agent runtime and SQLite storage.
- Optional connection to remote AgentOS Server instances.

## Boundaries

- **Studio owns:** UI, local runtime, local data, local LLM installation flow, and (when deployed) can expose its own MCP server for other programs to connect to.
- **Separate Server** is only needed if you want multi-tenant hosting, independent scaling of the backend, or strict separation between “Studio frontend” and “orchestration backend.”

## Deployment: Single unit vs separate Server

You do **not** have to separate Server from Studio for typical deployments.

- **Single deployment (recommended for most cases):** Run Studio as one unit (e.g. Docker on a server or Kubernetes). Expose:
  - The Studio app port (e.g. 3000) for the UI and API.
  - The MCP endpoint (same app or dedicated port, depending on how you mount the MCP server) so other programs (IDEs, agents, CLI tools) can connect to the MCP server.
- **Opening ports:** In Docker or Kubernetes, open the appropriate ports so external clients can reach the app and the MCP server. No separate “Server” process is required for MCP access.
- **Separate Server:** Consider a dedicated Server component only if you need multiple Studios sharing one backend, multi-tenant isolation, or to scale the orchestration layer independently from the Studio instances.

## Studio vs separate Server repo

**Studio has more functionality than the separate AgentOS Server repo.** The Studio implements the full HTTP API (agents, workflows, tools, runs, LLM, etc.) in Next.js API routes, plus chat, feedback, files, sandboxes, Ollama integration, stats, and more. The Server repo currently exposes only a health check and a minimal MCP stub; it does not implement the contract endpoints. The Studio runtime is also a superset (chat, feedback, sandbox, installers, pricing, rate limits, more LLM providers).

**Recommendation: bundle the Server from the Studio repo.** That way there is a single codebase and one place to implement and evolve the API. Options:

1. **Add a Server build in this repo** (e.g. `apps/server` or `packages/server`): a headless HTTP + MCP service that reuses Studio’s `packages/core` and `packages/runtime`, implements the contract in `contracts/server-api.md`, and can be built/deployed as a standalone process (e.g. for multi-tenant or scale-out). Same logic, same types, configurable storage (SQLite or Postgres if needed).
2. **Use Studio as the “server”** when a remote API is needed: deploy the Studio app and point clients at its API and MCP. No separate Server binary; the Studio process is the server.
3. **Deprecate the separate Server repo** once the Server is available as a build target from this repo, and document that “AgentOS Server” is either this repo’s server build or the Studio deployment.

This keeps one source of truth, avoids drift between Studio and Server, and makes it possible to ship a standalone server from the same repo when needed.

## Sandbox site hosting

Agents can host websites inside their sandbox. Bind a **domain or subdomain** to a sandbox (host + container port); traffic to that host is proxied to the container. When Studio runs in Docker or K8s, set **SANDBOX_BACKEND_HOST** (e.g. `host.docker.internal`) so the proxy can reach the host where sandbox ports are published. Route domains with a reverse proxy (Caddy, Nginx, Traefik) in front of Studio—see [sandbox-site-hosting.md](sandbox-site-hosting.md).

## Shared Contracts

The Studio uses shared contract definitions for any Server-compatible API (whether provided by this repo’s server build or by the Studio app itself):

- `contracts/server-api.md` for HTTP endpoints and payload shapes.
- `contracts/shared-types.md` for data models used in both.

For **sandbox site hosting** (agents hosting websites in their container, with domain routing and Docker/K8s), see [sandbox-site-hosting.md](sandbox-site-hosting.md) and set **SANDBOX_BACKEND_HOST** when Studio runs in Docker or K8s.

