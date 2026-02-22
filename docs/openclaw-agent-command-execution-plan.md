# Plan: Agent Gives Command, OpenClaw Executes It

**Goal:** Achieve an end-to-end flow where the Agentron Studio agent sends a command to OpenClaw via `send_to_openclaw`, and OpenClaw **actually executes** it (we can verify via `openclaw_history` with at least one message). No mocks.

This document is the result of deep research in the OpenClaw docs, gateway protocol, and this repo. It explains **why** the container path currently fails and **how** to achieve execution in each environment.

---

## 1. How the flow works (protocol and repo)

### 1.1 Gateway protocol (OpenClaw)

- **Source:** [Gateway Protocol](https://docs.clawd.bot/gateway/protocol), [OpenClaw Integration](https://docs.openclaw.ai/) (this repo: `docs/openclaw-integration.md`).
- **Transport:** WebSocket, JSON frames. First frame must be a `connect` request.
- **Handshake:** Client sends `connect` with `role: "operator"`, `scopes: ["operator.read", "operator.write"]` (and optionally `operator.admin`), and `auth: { token: "…" }` when the gateway requires auth.
- **Auth:** If `OPENCLAW_GATEWAY_TOKEN` (or `gateway.auth.token`) is set, the gateway requires the client’s `connect.params.auth.token` to match; otherwise the socket is closed.
- **Scopes:** The gateway enforces **server-side** which scopes a connection gets. Clients *request* scopes; the gateway *grants* or restricts them based on the token/device.
  - **Device tokens** (from pairing): Issued with explicit scopes in `hello-ok.auth` (e.g. `["operator.read", "operator.write"]`). Empty scopes on legacy device tokens are treated as “allow all” (see [openclaw/openclaw#16827](https://github.com/openclaw/openclaw/issues/16827)).
  - **Shared-secret token** (env or `gateway.auth.token`): Used only for *authentication*. The gateway’s assignment of scopes to this token is **not** documented in the public config reference. In practice, when the gateway is started with an env token (e.g. in a container), that token often receives **no usable scopes** or only `operator.read`, so `chat.send` returns “missing scope: operator.write” and sometimes `chat.history` returns “missing scope: operator.read”.
- **RPCs we care about:**
  - `chat.send` — requires **operator.write** (and sessionKey, message, idempotencyKey). This is what “agent gives command, OpenClaw executes it” uses.
  - `chat.history` — requires **operator.read**. Used to verify that OpenClaw replied.
  - `chat.abort` — requires appropriate scope (operator.write or similar).

So: for “agent gives command, OpenClaw executes it” we need a token that is **granted** both `operator.read` and `operator.write` (or a superset like `operator.admin`) by the gateway.

### 1.2 This repo

- **Client:** `packages/ui/app/api/_lib/openclaw-client.ts`
  - `buildConnectParams(token)` sends `scopes: ["operator.admin", "operator.read", "operator.write"]` and `auth: { token }` when token is set.
  - So we *request* full operator scopes; the gateway still *grants* based on the token.
- **Tools:** `send_to_openclaw` → `openclawSend()` → RPC `chat.send`; `openclaw_history` → `openclawHistory()` → RPC `chat.history`.
- **E2E:** `packages/ui/__tests__/e2e/openclaw.e2e.ts`
  - If no gateway is reachable, starts OpenClaw in a container (`create_sandbox` with `alpine/openclaw`, `bind_sandbox_port`), sets `OPENCLAW_GATEWAY_URL` and `OPENCLAW_GATEWAY_TOKEN`, waits for health, then runs one chat turn: “Use send_to_openclaw … then openclaw_history …”.
  - When the gateway was started **in the container** (`fromContainer === true`), the token in use (env `e2e-openclaw-token` or token read from container config) typically has **no usable scopes**; the test **fails** with a clear message instead of falsely passing.
- **Create sandbox (OpenClaw image):** `packages/ui/app/api/chat/_lib/execute-tool-handlers-workflows-runs-reminders.ts`
  - For images whose name contains `openclaw`, we pass `env: { OPENCLAW_GATEWAY_TOKEN: "e2e-openclaw-token" }` and `cmd: ["node", "openclaw.mjs", "gateway", "--allow-unconfigured", "--bind", "lan"]`.
  - So the container gateway **requires** that token for auth; the gateway then assigns scopes to that token (in current images: limited or none).

---

## 2. Why the container path fails today

- We start the container with **env** `OPENCLAW_GATEWAY_TOKEN=e2e-openclaw-token` and **--bind lan** (required for port-forwarding from host).
- Docs: “Binding beyond loopback without auth is blocked.” So we **must** provide a token for `--bind lan`.
- The gateway accepts the token (auth passes) but assigns it **no usable scopes** (or only operator.read). So:
  - `chat.send` → “missing scope: operator.write”
  - `chat.history` → sometimes “missing scope: operator.read”
- The e2e also tries to read `gateway.auth.token` from the container’s `~/.openclaw/openclaw.json` (written by the browser/control service) and optionally runs `openclaw onboard --non-interactive ...` in the container. If a different token is written and the gateway hot-reloads it, that token *might* have full scopes—but in practice the image/flow often doesn’t yield a token with write access, or we still use the env token for auth.

**Conclusion:** With the **current** OpenClaw images and our **current** create_sandbox (env token + `--bind lan`), the container path does **not** get a token with `operator.write`, so “agent gives command, OpenClaw executes it” does **not** work when using only the container.

---

## 3. Ways to achieve “agent gives command, OpenClaw executes it”

### Option A: Host gateway (recommended, works today)

**Idea:** Run OpenClaw on the host (or in a separate Docker Compose setup), use a token produced by **onboarding**, then point the Studio e2e at that gateway.

**Steps:**

1. On the host, install OpenClaw and run the **onboarding wizard** (so the gateway has a proper config and token):
   - `openclaw onboard` (interactive), or
   - Docker: `docker compose run --rm openclaw-cli onboard` then `docker compose up -d openclaw-gateway` (see [OpenClaw Docker](https://docs.openclaw.ai/install/docker)).
2. Start the gateway on the host:
   - `openclaw gateway` (or `openclaw gateway run`), or
   - Docker Compose: gateway container already up.
3. Set **environment** (or Vault) for the Studio:
   - `OPENCLAW_GATEWAY_URL` = WebSocket URL of the gateway (e.g. `ws://127.0.0.1:18789` or the URL from `docker compose run --rm openclaw-cli dashboard --no-open`).
   - `OPENCLAW_GATEWAY_TOKEN` = token from onboarding (Control UI → Settings → token, or from `~/.openclaw/openclaw.json` → `gateway.auth.token`).
4. Run the OpenClaw e2e: it will see the gateway is reachable, **not** start a container (`fromContainer === false`), and use your URL/token. With an onboard-generated token the gateway typically grants full operator scopes, so `send_to_openclaw` and `openclaw_history` succeed and the test passes.

**Pros:** No change to OpenClaw or our sandbox; works with current docs and images.  
**Cons:** Requires a host (or external) OpenClaw; CI must either skip the test or run a gateway (e.g. Docker Compose) and set env.

---

### Option B: Container gateway with token that has full scopes

**Idea:** Keep using a container started by our e2e, but obtain a token that the gateway **grants** `operator.read` and `operator.write`.

**Possible sub-approaches:**

#### B.1 OpenClaw image/version that grants full scopes to env token

- **Research:** Check OpenClaw release notes or source for any env/config that grants full operator scopes to the shared-secret token (e.g. `gateway.auth.scopes` or similar). The public [Configuration Reference](https://docs.openclaw.ai/gateway/configuration-reference) and [Security](https://docs.openclaw.ai/gateway/security) docs do not document such a key; the protocol doc states that the gateway enforces server-side allowlists.
- **Action:** Search openclaw/openclaw for where shared-secret (token) auth result is mapped to granted scopes; if there is a config or env to grant full scopes for e2e, we could set it in `create_sandbox` (e.g. env or mounted config).

#### B.2 Run onboarding inside the container and use that token

- **Idea:** Don’t rely on the env token for the *granted* scopes. Start the container with the gateway; run **onboarding** inside the container (non-interactive) so that a token is written to `~/.openclaw/openclaw.json` with the usual onboarding semantics (often full scopes). Then use that token for the Studio and, if necessary, make the gateway use it (e.g. hot-reload or restart).
- **Details:**
  - OpenClaw’s own e2e uses `node "$OPENCLAW_ENTRY" onboard --non-interactive --accept-risk --flow quickstart --mode local --skip-channels --skip-skills ...` ([scripts/e2e/onboard-docker.sh](https://github.com/openclaw/openclaw/blob/main/scripts/e2e/onboard-docker.sh)). Our e2e already tries a similar `onboard` in the container; success depends on the image exposing the same entrypoint and the gateway picking up the new config.
  - If the gateway was started with **env** `OPENCLAW_GATEWAY_TOKEN`, it may ignore or override `gateway.auth.token` from config until restart. So we may need to either:
    - Start the container **without** `OPENCLAW_GATEWAY_TOKEN`, run onboard first (e.g. via a second container or an exec that runs before the gateway), write config, then start the gateway so it reads `gateway.auth.token` from config; or
    - Start the gateway with env token, run onboard to write config, then **restart** the gateway process in the container (e.g. `kill -USR1` if the gateway supports in-process restart, or restart the container with the same config volume) so it reloads and uses the onboard token.
  - After that, read `gateway.auth.token` from the container’s config and set `OPENCLAW_GATEWAY_TOKEN` for the e2e.
- **Action:** Implement a clear “container with onboard” flow: e.g. (1) create container with OpenClaw image but **no** env token and a cmd that runs onboard then starts the gateway (or two-phase: run onboard in a temporary container/exec, then start gateway container with mounted config); (2) read token from config; (3) bind port and run e2e. Document image/version requirements (e.g. `alpine/openclaw` with CLI that supports `onboard --non-interactive ...`).

#### B.3 Device pairing (operator client as “device”)

- **Idea:** Protocol doc says device tokens are issued with scopes in `hello-ok.auth`. If we could complete **device pairing** from our client (with device identity and challenge signature), we might receive a device token with full scopes.
- **Reality:** The protocol requires a `device` object (id, publicKey, signature, signedAt, nonce) and “All connections must sign the server-provided connect.challenge nonce.” Control UI can omit device only when `gateway.controlUi.dangerouslyDisableDeviceAuth` is enabled. So implementing a proper device pairing from the Studio (with cryptographic signing) is non-trivial and may be out of scope for e2e.
- **Action:** Treat as future work unless we explicitly want to implement an operator client that does full device pairing.

---

### Option C: Loopback + no auth (container only, no port-forward)

- **Idea:** Run the gateway in the container with `--bind loopback` and no token (auth none). Then only **loopback** connections are accepted; port-forward from host would appear as non-loopback to the container and be rejected. So this only works if the “agent” and “OpenClaw” run in the **same** container (e.g. e2e runs a script inside the container that calls the gateway at `ws://127.0.0.1:18789`). That would mean we’re not testing the real Studio → OpenClaw path from the host.
- **Conclusion:** Not suitable for “Studio agent on host gives command to OpenClaw (in container) and we verify from host.” Skip unless we add a separate in-container e2e.

---

### Option D: CI / optional e2e

- **Idea:** Accept that “agent gives command, OpenClaw executes it” is only validated when a **host (or external) gateway** with a proper token is available. In CI, either:
  - **Skip** the OpenClaw e2e when no gateway is configured (current behavior when no gateway is reachable), or
  - **Run** a gateway in CI (e.g. Docker Compose from OpenClaw repo, or a job that runs `onboard` + gateway and sets `OPENCLAW_GATEWAY_URL` and `OPENCLAW_GATEWAY_TOKEN`) so the same test runs with Option A.
- **Action:** Document in CI and in this plan that the OpenClaw e2e is “opt-in” for full execution (host or CI-run gateway); when only the container is used, the test correctly **fails** with a clear message.

---

## 4. Recommended implementation order

1. **Document and keep Option A**  
   - In `docs/openclaw-integration.md` and `docs/openclaw-e2e-plan.md`, state clearly: for “agent gives command, OpenClaw executes it” use a **host gateway** (onboard + gateway, set `OPENCLAW_GATEWAY_URL` and `OPENCLAW_GATEWAY_TOKEN`). E2E passes when that gateway is used.

2. **Harden container path (Option B.2)**  
   - Implement a **two-phase container flow**:
     - Phase 1: Start a container with OpenClaw image; run **onboard** (non-interactive) inside it (e.g. exec or a dedicated entrypoint) so `~/.openclaw/openclaw.json` is written with `gateway.auth.token` (and optionally `gateway.mode: "local"`).
     - Phase 2: Start the gateway in that container (or restart if already running) so it uses the token from config. No (or minimal) env token so the gateway’s required token is the one from onboard.
   - E2E: create sandbox (with the new flow), bind port, read token from config, set `OPENCLAW_GATEWAY_URL` and `OPENCLAW_GATEWAY_TOKEN`, run health and then the same send + history test.
   - Document which image/version supports this (e.g. `alpine/openclaw` with `openclaw.mjs onboard` and non-interactive flags).

3. **Option B.1 (upstream/config)**  
   - If someone finds or adds a way in OpenClaw to grant full operator scopes to the shared-secret token (config or env), we can then simplify the container flow by setting that in `create_sandbox` and keep a single-phase start.

4. **CI (Option D)**  
   - Either keep the test as “skip when no gateway” or add a CI job that runs a gateway (Docker Compose or host) and sets env so the OpenClaw e2e runs with Option A.

---

## 5. Summary table

| Approach | Agent gives command, OpenClaw executes | Effort | Notes |
|----------|----------------------------------------|--------|------|
| **A. Host gateway** | Yes | None (docs only) | Onboard + gateway on host; set URL + token. Works today. |
| **B.1 Full-scope env token** | Yes, if upstream supports it | Research + possible config | Depends on OpenClaw adding/configuring scope grant for shared-secret token. |
| **B.2 Onboard in container** | Yes, if flow is implemented | Medium | Two-phase container: onboard → start/restart gateway → use config token. |
| **B.3 Device pairing** | Theoretically yes | High | Implement signing and device identity; likely out of scope for e2e. |
| **C. Loopback, no auth** | Not for host→container | Low | Only useful for in-container-only tests. |
| **D. CI + host gateway** | Yes in CI | Low | CI job runs gateway (e.g. Compose) and sets env; same as Option A. |

---

## 6. References

- [Gateway Protocol](https://docs.clawd.bot/gateway/protocol) — handshake, roles, scopes, auth.
- [OpenClaw Docker](https://docs.openclaw.ai/install/docker) — `docker-setup.sh`, onboard, manual compose flow.
- [OpenClaw Security](https://docs.openclaw.ai/gateway/security) — bind, auth, token.
- [OpenClaw CLI gateway](https://docs.openclaw.ai/cli/gateway) — `--allow-unconfigured`, `--token`, `--bind`, `--auth`.
- [OpenClaw Gateway Pairing](https://docs.openclaw.ai/gateway/pairing) — device pairing, tokens.
- This repo: `docs/openclaw-integration.md`, `docs/openclaw-e2e-plan.md`, `packages/ui/app/api/_lib/openclaw-client.ts`, `packages/ui/__tests__/e2e/openclaw.e2e.ts`, `packages/ui/app/api/chat/_lib/execute-tool-handlers-workflows-runs-reminders.ts` (create_sandbox for openclaw image).
