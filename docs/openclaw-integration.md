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

## Option A: Host gateway (agent gives command, OpenClaw executes it)

To have the Studio agent **send a command and have OpenClaw actually execute it** (and verify via history), use a **host gateway** with a token that has full operator scopes. The gateway must be reachable before the Studio (or e2e) connects; the token comes from onboarding.

**Steps:**

1. **Install OpenClaw** on the host (see [OpenClaw install](https://docs.openclaw.ai/install)).
2. **Run onboarding** so the gateway has a config and token:
   ```bash
   openclaw onboard
   ```
   Complete the wizard; the token is written to `~/.openclaw/openclaw.json` (`gateway.auth.token`) and shown in the Control UI (Settings → token).
3. **Start the gateway** on the host:
   ```bash
   openclaw gateway
   ```
   Or `openclaw gateway run` (foreground). Default port is 18789.
4. **Set environment** for the Studio (or for the e2e test):
   - `OPENCLAW_GATEWAY_URL` = `ws://127.0.0.1:18789` (or your gateway URL if different).
   - `OPENCLAW_GATEWAY_TOKEN` = the token from onboarding (from Control UI or `~/.openclaw/openclaw.json` → `gateway.auth.token`).
5. **Run the Studio** (or the OpenClaw e2e). The agent can use `send_to_openclaw` to send commands; OpenClaw will execute them and you can confirm with `openclaw_history`.

**Run the OpenClaw e2e (full flow):**

```bash
# Terminal 1: ensure gateway is running (after onboard)
openclaw gateway

# Terminal 2: set env then run e2e (from repo root)
export OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
export OPENCLAW_GATEWAY_TOKEN="<paste token from openclaw onboard or Control UI>"
cd packages/ui && npx vitest run --config vitest.e2e.config.ts __tests__/e2e/openclaw.e2e.ts
```

If the gateway is reachable and the token has full scopes, the test will **not** start a container; it will use your host gateway and assert `send_to_openclaw` success and `openclaw_history` with at least one message. See `docs/openclaw-e2e-plan.md` and `docs/openclaw-agent-command-execution-plan.md`.

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

**Container startup (create_sandbox):** For the OpenClaw image, the sandbox runs onboard then gateway so the gateway uses the token from config. A break-glass config patch is attempted so token-only Control UI connect works over port-forward (gateway sees bridge IP, not loopback); support depends on the image version. The client sends **device identity** (Ed25519, matching OpenClaw’s protocol) so the gateway can accept connections from the host. For e2e, the test reads the gateway token from the container (config or CLI); for reliable e2e without debugging container paths, use a **host gateway** with `OPENCLAW_GATEWAY_URL` and `OPENCLAW_GATEWAY_TOKEN` set (see Option A).

## API routes

The Studio exposes HTTP API routes that proxy to the OpenClaw Gateway (for use by the chat tools or by other clients):

- `GET /api/openclaw/status` — Gateway status (WebSocket RPC `status`).
- `POST /api/openclaw/send` — Send a message (body: `{ "content": "…", "sessionKey?: "…" }`).
- `GET /api/openclaw/history` — Chat history (query: `?sessionKey=…&limit=20`).
- `POST /api/openclaw/abort` — Abort current run (body: `{ "sessionKey": "…" }` optional).

## Troubleshooting

- **"OpenClaw: …" error in chat:** Ensure the OpenClaw Gateway is running (`openclaw gateway` or `openclaw gateway start`). If you use token auth, set `OPENCLAW_GATEWAY_TOKEN`.
- **Connection timeout:** Check that `OPENCLAW_GATEWAY_URL` matches the host/port where the Gateway is listening (default `ws://127.0.0.1:18789`).
