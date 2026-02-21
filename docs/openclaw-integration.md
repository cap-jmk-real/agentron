# OpenClaw Integration

Agentron can interact with and steer a running [OpenClaw](https://openclaw.ai) instance (personal AI assistant gateway). The Studio chat assistant can send commands to OpenClaw, read its history, and abort runs.

The integration uses the **official OpenClaw Gateway WebSocket protocol** ([Gateway Protocol](https://docs.clawd.bot/gateway/protocol)): request/response/event framing (`type: "req"` / `"res"` / `"event"`), a connect handshake (protocol version 3, role `operator`, scopes `operator.read` / `operator.write`, optional token auth), and the documented method params (`chat.send` with `sessionKey`, `message`, `idempotencyKey`; `chat.history` with `sessionKey`; `chat.abort` with `sessionKey`).

## Heap (specialist structure)

In **heap mode**, OpenClaw tools are available via the **agent** specialist, structured as two parts with option groups:

- **agent_lifecycle** — Agent CRUD, versions, rollback, LLM providers (`list_agents`, `create_agent`, `get_agent`, etc.).
- **agent_openclaw** — OpenClaw instance (`send_to_openclaw`, `openclaw_history`, `openclaw_abort`).

The heap UI and planner see semantic part names and option groups (e.g. "OpenClaw instance (send, history, abort)").

## Prerequisites

- OpenClaw must be installed and the **Gateway** must be running (e.g. `openclaw gateway` or `openclaw gateway run` on port 18789 by default).
- Optional: run `openclaw onboard` once to configure OpenClaw; use `ollama launch openclaw` if you want OpenClaw to use Ollama.

## Environment variables

Set these in your environment (or in `.env.local` when running the Studio) to connect to the OpenClaw Gateway:

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENCLAW_GATEWAY_URL` | WebSocket URL of the OpenClaw Gateway | `ws://127.0.0.1:18789` |
| `OPENCLAW_GATEWAY_TOKEN` | Gateway auth token (if required) | — |

If the Gateway is protected by token auth (e.g. after onboarding), set `OPENCLAW_GATEWAY_TOKEN` to the token shown by `openclaw onboard` or in the Control UI settings.

**Credentials (Vault):** You can store `OPENCLAW_GATEWAY_URL` and `OPENCLAW_GATEWAY_TOKEN` in Settings → Vault under keys `openclaw_gateway_url` and `openclaw_gateway_token`. When the vault is unlocked, the chat will use these values for OpenClaw tool calls.

**Multiple OpenClaw containers:** To target a specific gateway when several are running, set `OPENCLAW_GATEWAY_URL` to the desired one, or pass **gatewayUrl** in the tool call (see Chat tools).

## Chat tools

When the OpenClaw Gateway is reachable, the Studio chat assistant can use:

- **send_to_openclaw** — Send a message or command to OpenClaw (e.g. "Check my calendar", "Send an email to …"). Optional **gatewayUrl** to target a specific gateway when multiple OpenClaw containers are run.
- **openclaw_history** — Get recent chat history from OpenClaw. Optional **gatewayUrl** for multi-container targeting.
- **openclaw_abort** — Abort the current OpenClaw run. Optional **gatewayUrl** for multi-container targeting.

The user can say things like "Ask OpenClaw to check my calendar" or "What did OpenClaw last say?" in the Studio chat.

## Running OpenClaw in a container

The flow is **container-engine agnostic** (Docker or Podman; use Settings → Container engine).

**Official image: alpine/openclaw** (Docker Hub):

- Image: `alpine/openclaw:latest` or `alpine/openclaw:main` (~1.1 GB).
- OpenClaw gateway is **pre-installed**; no install step inside the container.
- Works with both Docker and Podman.
- Links: [alpine/openclaw on Docker Hub](https://hub.docker.com/r/alpine/openclaw), [OpenClaw Docker docs](https://docs.openclaw.ai/install/docker).

**Steps:**

1. **create_sandbox** with image `alpine/openclaw:latest` (or `:main`). The gateway starts with the container on port 18789.
2. **bind_sandbox_port(sandboxId, 18789)** to expose the container port to the host. The tool returns a host port and WebSocket URL (e.g. `ws://127.0.0.1:50100`).
3. Set `OPENCLAW_GATEWAY_URL` to that URL, or pass **gatewayUrl** in `send_to_openclaw` / `openclaw_history` / `openclaw_abort` when calling.

**Multiple containers:** You can run multiple OpenClaw containers (one sandbox per container). Call **bind_sandbox_port(sandboxId, 18789)** once per sandbox; each gets a **distinct host port** and WebSocket URL. Target one via `OPENCLAW_GATEWAY_URL` or by passing optional **gatewayUrl** in the OpenClaw tool calls.

## API routes

The Studio exposes HTTP API routes that proxy to the OpenClaw Gateway (for use by the chat tools or by other clients):

- `GET /api/openclaw/status` — Gateway status (WebSocket RPC `status`).
- `POST /api/openclaw/send` — Send a message (body: `{ "content": "…", "sessionKey?: "…" }`).
- `GET /api/openclaw/history` — Chat history (query: `?sessionKey=…&limit=20`).
- `POST /api/openclaw/abort` — Abort current run (body: `{ "sessionKey": "…" }` optional).

## Troubleshooting

- **"OpenClaw: …" error in chat:** Ensure the OpenClaw Gateway is running (`openclaw gateway` or `openclaw gateway start`). If you use token auth, set `OPENCLAW_GATEWAY_TOKEN`.
- **Connection timeout:** Check that `OPENCLAW_GATEWAY_URL` matches the host/port where the Gateway is listening (default `ws://127.0.0.1:18789`).
