# OpenClaw Integration

Agentron can interact with and steer a running [OpenClaw](https://openclaw.ai) instance (personal AI assistant gateway). The Studio chat assistant can send commands to OpenClaw, read its history, and abort runs.

The integration uses the **official OpenClaw Gateway WebSocket protocol** ([Gateway Protocol](https://docs.clawd.bot/gateway/protocol)): request/response/event framing (`type: "req"` / `"res"` / `"event"`), a connect handshake (protocol version 3, role `operator`, scopes `operator.read` / `operator.write`, optional token auth), and the documented method params (`chat.send` with `sessionKey`, `message`, `idempotencyKey`; `chat.history` with `sessionKey`; `chat.abort` with `sessionKey`).

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

## Chat tools

When the OpenClaw Gateway is reachable, the Studio chat assistant can use:

- **send_to_openclaw** — Send a message or command to OpenClaw (e.g. "Check my calendar", "Send an email to …").
- **openclaw_history** — Get recent chat history from OpenClaw so the assistant can summarize what OpenClaw said or did.
- **openclaw_abort** — Abort the current OpenClaw run.

The user can say things like "Ask OpenClaw to check my calendar" or "What did OpenClaw last say?" in the Studio chat.

## API routes

The Studio exposes HTTP API routes that proxy to the OpenClaw Gateway (for use by the chat tools or by other clients):

- `GET /api/openclaw/status` — Gateway status (WebSocket RPC `status`).
- `POST /api/openclaw/send` — Send a message (body: `{ "content": "…", "sessionKey?: "…" }`).
- `GET /api/openclaw/history` — Chat history (query: `?sessionKey=…&limit=20`).
- `POST /api/openclaw/abort` — Abort current run (body: `{ "sessionKey": "…" }` optional).

## Troubleshooting

- **"OpenClaw: …" error in chat:** Ensure the OpenClaw Gateway is running (`openclaw gateway` or `openclaw gateway start`). If you use token auth, set `OPENCLAW_GATEWAY_TOKEN`.
- **Connection timeout:** Check that `OPENCLAW_GATEWAY_URL` matches the host/port where the Gateway is listening (default `ws://127.0.0.1:18789`).
