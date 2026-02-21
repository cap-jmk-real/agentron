---
name: OpenClaw heap tests docs
overview: Add OpenClaw to the heap as part of the agent specialist (structured with optionGroups), add unit and e2e tests, document integration and credentials, and optionally wire vault credentials for the OpenClaw gateway.
todos:
  - id: heap-agent
    content: Add partIds to registry; structure agent specialist with agent_lifecycle / agent_openclaw and optionGroups (registry.ts)
    status: pending
  - id: credentials
    content: Document credentials; optionally wire vault for OPENCLAW_GATEWAY_TOKEN/URL
    status: pending
  - id: unit-tests
    content: ""
    status: pending
  - id: e2e
    content: "E2E test: setup OpenClaw container via agent tools (sandbox + port binding) then communicate"
    status: pending
  - id: bind-sandbox-port
    content: Add bind_sandbox_port tool (runtime def + execute-tool handler) to expose container port to host
    status: pending
  - id: docs
    content: Update openclaw-integration.md, docs site, README
    status: pending
  - id: multi-openclaw
    content: Optional gatewayUrl on OpenClaw tools + handler pass-through; document multiple containers
    status: pending
isProject: false
---

# OpenClaw: Heap, Tests, Docs, and Credentials

## Current state

- **OpenClaw tools** exist in the runtime (`[packages/runtime/src/chat/tools/openclaw-tools.ts](packages/runtime/src/chat/tools/openclaw-tools.ts)`) and are in the flat `ASSISTANT_TOOLS` list (`[packages/runtime/src/chat/tools/index.ts](packages/runtime/src/chat/tools/index.ts)`).
- **Heap registry** (`[packages/runtime/src/chat/heap/registry.ts](packages/runtime/src/chat/heap/registry.ts)`) does **not** assign OpenClaw tools to any specialist.
- **Credentials**: Only env vars `OPENCLAW_GATEWAY_URL` and `OPENCLAW_GATEWAY_TOKEN` are used; no vault or GUI path.
- **Tests**: OpenClaw client and API routes are excluded from coverage; no dedicated unit tests for OpenClaw tool handlers; no e2e for OpenClaw.
- **Docs**: `[docs/openclaw-integration.md](docs/openclaw-integration.md)` exists but does not mention heap or vault; the docs site and README do not mention OpenClaw.

---

## 1. Structure the agent specialist and include OpenClaw

**Goal:** Make OpenClaw available in heap mode as a **subsection of the agent specialist**, with a clear structure so the heap (and Heap UI) can distinguish "agent lifecycle" from "OpenClaw instance" and chunking is semantic.

### 1.1 Proposal: structured agent specialist

**Semantic part names:** The registry currently builds leaf ids as `agent__part1`, `agent__part2` — not understandable. Add optional **partIds** so leaves have meaningful names (see 1.1 below). Chunking is by **array order**. To get a meaningful split:

1. **Semantic part ids (registry):** Extend `LogicalSpecialistSpec` with optional `partIds?: string[]`. When a spec is chunked into N parts, if `partIds.length === N`, use `partIds[i]` as the leaf id instead of `${id}__part${i+1}`. Require `partIds[i].startsWith(spec.id + "_")` so `getSubspecialistParent` still works. For agent, set `partIds: ["agent_lifecycle", "agent_openclaw"]` so the Heap UI shows readable names.
2. **Order `toolNames**` so the first chunk is agent lifecycle, the second is OpenClaw:
  - **agent_lifecycle** (first 10): Agent CRUD and versions — `list_agents`, `list_tools`, `create_agent`, `get_agent`, `update_agent`, `delete_agent`, `list_agent_versions`, `rollback_agent`, `list_llm_providers`, `ask_user`.
  - **agent_openclaw** (next 3): OpenClaw instance — `send_to_openclaw`, `openclaw_history`, `openclaw_abort`.
3. **Add `optionGroups` to the agent spec** (same pattern as `improve_agents_workflows`). The delegator root holds these so the planner/improver and Heap UI can see structure:
  - **agent_lifecycle**: label e.g. "Agent CRUD, versions, rollback, LLM providers"; `toolIds`: the 10 lifecycle tools above.
  - **openclaw**: label e.g. "OpenClaw instance (send, history, abort)"; `toolIds**:` send_to_openclaw`,` openclaw_history`,` openclaw_abort`.
4. **Root description:** e.g. "Agents: list, create, get, update, delete, versions, rollback, list tools, LLM providers; and OpenClaw instance (send commands, history, abort) when an agent runs or steers OpenClaw."

**Result:** The router still sees one top-level **agent**. The Heap UI and logs show **agent_lifecycle** and **agent_openclaw** (not part1/part2). Delegation and option groups work as before.

### 1.2 Implementation

- **Registry** (`[packages/runtime/src/chat/heap/registry.ts](packages/runtime/src/chat/heap/registry.ts)`):
  - Add optional `partIds?: string[]` to `LogicalSpecialistSpec`. In `buildRegistryFromSpecs`, when creating leaf specialists from chunks: if `spec.partIds` is defined and `spec.partIds.length === chunks.length`, use `spec.partIds[index]` as the leaf id (ensure it starts with `spec.id + "_"`); otherwise keep `${id}__part${index + 1}`.
  - In `buildDefaultRegistry()`, replace the **agent** spec: `toolNames` in order (10 lifecycle, then 3 OpenClaw), **partIds: ["agent_lifecycle", "agent_openclaw"]**, **optionGroups** (`agent_lifecycle`, `openclaw`), and updated **description**.
- No new top-level ids; agent stays one of the existing 7.

**Note:** The same `partIds` mechanism can be applied later to other multi-part specialists (e.g. workflow, improve_agents_workflows) so the whole heap uses readable names instead of `__part1`/`__part2`.

---

## 2. Credentials (env + optional vault)

**Goal:** Support passing OpenClaw gateway credentials so more users can use it from the GUI.

- **Document env vars** in [docs/openclaw-integration.md](docs/openclaw-integration.md) and in the docs site. Ensure `OPENCLAW_GATEWAY_URL` and `OPENCLAW_GATEWAY_TOKEN` are clearly listed. For **multiple OpenClaw containers**, document that targeting is via `OPENCLAW_GATEWAY_URL` (one default) or per-call `gatewayUrl` on the tools (see 4.3).
- **Optional vault wiring:** When the chat path has `vaultKey`, resolve `OPENCLAW_GATEWAY_TOKEN` (and optionally `OPENCLAW_GATEWAY_URL`) from the vault via `getStoredCredential` in the OpenClaw handlers and pass them into `openclawSend` / `openclawHistory` / `openclawAbort` options. Document in openclaw-integration.md that users can store these keys in Settings → Vault.

**Files to change:**

- `[packages/ui/app/api/chat/_lib/execute-tool-handlers-workflows-runs-reminders.ts](packages/ui/app/api/chat/_lib/execute-tool-handlers-workflows-runs-reminders.ts)`: In the `send_to_openclaw`, `openclaw_history`, and `openclaw_abort` branches, resolve URL/token from vault when `vaultKey` is present and pass them into the client calls.

---

## 3. Unit tests

**Goal:** Add unit tests that give **sufficient coverage** of all **unit-testable** OpenClaw-related code. (The openclaw-client and `api/openclaw/*` routes are excluded from coverage in [vitest.config.ts](packages/ui/vitest.config.ts); the code that calls them is in scope and must be covered.)

**Unit tests do not run any container.** They use mocks only (mock `openclaw-client` and optionally `getStoredCredential`). No Podman/Docker, no alpine/openclaw image, no sandbox creation. So **CI can run the full unit test suite without a container engine** — only the E2E test (section 4) optionally uses a container and is skipped when the engine or image is unavailable.

**Unit-testable files in scope for coverage:**

- **Execute-tool handlers** in [execute-tool-handlers-workflows-runs-reminders.ts](packages/ui/app/api/chat/_lib/execute-tool-handlers-workflows-runs-reminders.ts): the `send_to_openclaw`, `openclaw_history`, and `openclaw_abort` branches (argument validation, success paths, catch paths, and any vault URL/token resolution when added).
- **Heap registry** (runtime): default registry includes OpenClaw tools under the agent specialist and semantic part ids; covered via [heap.test.ts](packages/ui/__tests__/api/_lib/heap.test.ts) which imports and tests `getRegistry()`.

**3.1 Heap registry**

- In [packages/ui/**tests**/api/_lib/heap.test.ts](packages/ui/__tests__/api/_lib/heap.test.ts): Assert that the default registry exposes the three OpenClaw tool names under the agent specialist (combined tool set of `agent_lifecycle` and `agent_openclaw` includes `send_to_openclaw`, `openclaw_history`, `openclaw_abort`). Assert that leaf ids are semantic (`agent_lifecycle`, `agent_openclaw`) not `agent__part1`/`agent__part2`. Assert that the agent delegator has `optionGroups` with `agent_lifecycle` and `openclaw`. Ensures full coverage of the registry changes for OpenClaw.

**3.2 Execute-tool handlers (OpenClaw)**

- In [packages/ui/**tests**/api/_lib/execute-tool.test.ts](packages/ui/__tests__/api/_lib/execute-tool.test.ts): Mock `../../_lib/openclaw-client`. Cover **all branch paths** in the three handler cases so the unit-testable handler code has sufficient coverage:
  - **send_to_openclaw:** missing or empty `content` → error; mock resolve with `runId` → success message; mock reject → error containing "OpenClaw" and hint message.
  - **openclaw_history:** mock resolve with `messages` array → result has `messages` and `message`; mock resolve with `error` → result has `error` and `messages: []`; mock reject → error and `messages: []`. If `limit` is passed, cover valid and capped values (e.g. limit capped to 50).
  - **openclaw_abort:** mock resolve with `ok: true` → "OpenClaw run aborted"; mock resolve with `ok: false` / `error` → error result; mock reject → error containing "OpenClaw".
- When vault wiring is added, add tests that pass `vaultKey` and mock `getStoredCredential` to return URL/token and assert they are passed to the openclaw client (so those branches are covered).
- Run `npm run test:coverage` and confirm the OpenClaw handler branches in execute-tool-handlers-workflows-runs-reminders.ts are covered; add or adjust tests until coverage is sufficient.

---

## 4. E2E tests

**Goal:** Add an e2e test that (1) **sets up an OpenClaw container via the same tools an agent would use** (create_sandbox, execute_code, port exposure), then (2) **communicates** with OpenClaw (send_to_openclaw, openclaw_history). This validates the full flow: container setup and gateway communication.

### 4.1 E2E flow

1. **Setup OpenClaw in a container (agent-style tool chain)**
  - Use the **alpine/openclaw** image (Docker Hub): OpenClaw gateway is pre-installed — no install inside the container. Image is container-engine agnostic (Docker or Podman). Tags: `alpine/openclaw:latest` or `alpine/openclaw:main` (~1.1 GB). See [alpine/openclaw](https://hub.docker.com/r/alpine/openclaw) and [OpenClaw Docker](https://docs.openclaw.ai/install/docker).
  - **create_sandbox** with image `alpine/openclaw:latest` (or `:main`). The gateway starts with the container (image CMD runs the gateway on port 18789).
  - **Expose container port 18789** to the host so the test runner can connect. Today this is done via the **sandbox site-bindings API** (POST `[packages/ui/app/api/sandbox/[id]/site-bindings](packages/ui/app/api/sandbox/[id]/site-bindings)` with `{ host: "127.0.0.1", containerPort: 18789 }`), which returns the allocated host port. There is **no chat tool** for this yet; the e2e can call the app’s HTTP API from the test, or see 4.2.
  - Set `OPENCLAW_GATEWAY_URL` (or pass URL into the OpenClaw client) to `ws://127.0.0.1:<hostPort>`.
2. **Communicate**
  - **send_to_openclaw** with a short message (e.g. "Say hello"); assert success or defined error shape.
  - **openclaw_history**; assert result has a `messages` array (or error).
  - Optionally **openclaw_abort** if a run is in progress.
3. **Without gateway (fallback)**
  If the container engine is unavailable or the OpenClaw image cannot be used, skip the full flow and run only: `executeTool("send_to_openclaw", { content: "hello" }, undefined)` and expect an error containing "OpenClaw" (so the test still documents expected behavior when the gateway is down).

**Prerequisites:** A container engine (Docker or Podman, per Settings) and the **alpine/openclaw** image (e.g. `alpine/openclaw:latest` — OpenClaw is pre-installed). The flow is **container-engine agnostic**. Skip the full setup+communicate flow when prerequisites are not met (like Ollama in e2e-setup); do not fail CI.

### 4.2 Other tools necessary for the OpenClaw flow

For an **agent** to fully “set up OpenClaw in a container and then communicate” using only chat tools, the following are needed:

- **Already available:** `create_sandbox`, `list_sandboxes`, `execute_code` (create and run the container; use the alpine/openclaw image so OpenClaw is pre-installed — no install step), `send_to_openclaw`, `openclaw_history`, `openclaw_abort`. These use the Studio’s container engine (Docker or Podman, per Settings), so the OpenClaw-in-container flow is **container-engine agnostic**.
- **Required:** Add **bind_sandbox_port** so the gateway port (18789) can be exposed via a chat tool. The Studio has a **sandbox site-bindings** REST API ([packages/ui/app/api/sandbox/[id]/site-bindings/route.ts](packages/ui/app/api/sandbox/[id]/site-bindings/route.ts)); a **bind_sandbox_port** tool is required so agents can bind container port 18789 via tools.

**Implement bind_sandbox_port (mandatory):** Add the tool so agents and E2E can expose container port to host via tools. (1) **Runtime:** Add tool def (e.g. in misc-tools.ts): name `bind_sandbox_port`, params `sandboxId`, `containerPort`, optional `host`. (2) **Handler:** In execute-tool-handlers-workflows-runs-reminders.ts, add case that reuses site-bindings logic (see sandbox/[id]/site-bindings/route.ts), returns host port and optional WebSocket URL. Flow: create_sandbox → bind_sandbox_port 18789 → OPENCLAW_GATEWAY_URL → send_to_openclaw / openclaw_history. E2E uses this tool for port exposure.

### 4.3 Multiple OpenClaw containers

When **multiple OpenClaw containers** are run (e.g. several sandboxes each with `alpine/openclaw`), each has its own gateway on container port 18789.

**Binding with multiple containers:** Binding is **per sandbox**. Each container is a separate sandbox with its own `sandboxId`. For each OpenClaw container the agent (or user) calls **bind_sandbox_port(sandboxId, 18789)** once; the handler/site-bindings allocate a **distinct host port** per sandbox (e.g. sandbox A → 50100, sandbox B → 50101), so there is no port conflict. The tool returns the host port and optional WebSocket URL (e.g. `ws://127.0.0.1:50100`) so the agent can record which gateway URL corresponds to which sandbox. With multiple containers, the agent should call bind_sandbox_port for each sandbox and then use the returned URL (via **gatewayUrl** per call or env) when talking to OpenClaw.

**Targeting a specific gateway:**

1. **Single default (env):** Set `OPENCLAW_GATEWAY_URL` to `ws://127.0.0.1:<hostPort>` for the container you want to use. To switch, change env (or use a different process/session).
2. **Per-call URL (recommended for multiple containers):** Add an optional **gatewayUrl** (or **url**) parameter to the three OpenClaw tools (`send_to_openclaw`, `openclaw_history`, `openclaw_abort`). When provided, the handler passes it as `options.url` to the openclaw client (the client already supports `options.url` in [openclaw-client.ts](packages/ui/app/api/_lib/openclaw-client.ts)). The agent can then target different containers in the same conversation without changing env (e.g. "send to OpenClaw at ws://127.0.0.1:50101").

**Implementation:** (1) In [openclaw-tools.ts](packages/runtime/src/chat/tools/openclaw-tools.ts), add optional `gatewayUrl` (string, description e.g. "Override gateway URL for this call (e.g. ws://127.0.0.1:&lt;hostPort&gt;); use when multiple OpenClaw containers are run and you need to target one.") to the three tool parameter schemas. (2) In execute-tool handlers for `send_to_openclaw`, `openclaw_history`, and `openclaw_abort`, when `gatewayUrl` is present pass it to the client as `options.url`. (3) Document in [docs/openclaw-integration.md](docs/openclaw-integration.md): multiple containers, distinct host ports per sandbox, targeting via `OPENCLAW_GATEWAY_URL` or per-call `gatewayUrl`.

**E2E:** The existing E2E can stay single-container. Optionally add a one-sentence note in the test or plan that multi-container is supported (each binding gets a different host port; targeting via URL).

---

## 5. Docs and docs site

**Goal:** Include OpenClaw in docs and the heap so users and the docs site reflect the integration and credentials.

**5.1 Internal doc**

- [docs/openclaw-integration.md](docs/openclaw-integration.md):
  - Add a **Heap** section: In heap mode, OpenClaw tools are available via the **agent** specialist (structured as agent lifecycle + OpenClaw parts with optionGroups).
  - Add a **Credentials** note: env vars and optional Vault keys `OPENCLAW_GATEWAY_TOKEN` / `OPENCLAW_GATEWAY_URL`.
  - **Running OpenClaw in a container:** Add a section that (1) states the flow is **container-engine agnostic** (Docker or Podman, per Settings → Container engine). (2) **Document the official image:** **alpine/openclaw** (Docker Hub). Include: image name and tags (`alpine/openclaw:latest`, `alpine/openclaw:main`), that OpenClaw gateway is pre-installed (no install in container), approximate size (~1.1 GB), and that it works with both Docker and Podman. Link to [alpine/openclaw](https://hub.docker.com/r/alpine/openclaw) and [OpenClaw Docker](https://docs.openclaw.ai/install/docker). Steps: `create_sandbox` with `alpine/openclaw:latest`, expose port 18789 (bind_sandbox_port), set `OPENCLAW_GATEWAY_URL` or pass `gatewayUrl` per call. (3) **Multiple containers:** You can run multiple OpenClaw containers (one sandbox per container). Call **bind_sandbox_port(sandboxId, 18789)** once per sandbox; each gets a **distinct host port** and WebSocket URL. Target one via `OPENCLAW_GATEWAY_URL` or by passing optional `gatewayUrl` in the OpenClaw tool calls.

**5.2 Docs site (Nextra) — official docs**

- Add OpenClaw to the docs site (section under [concepts/tools.mdx](apps/docs/content/concepts/tools.mdx) or [capabilities.mdx](apps/docs/content/capabilities.mdx), or a new page). **Document the image in the official docs:** mention the **alpine/openclaw** image as the recommended way to run the OpenClaw gateway in a container (image name, pre-installed gateway, container-engine agnostic), with link to [docs/openclaw-integration.md](docs/openclaw-integration.md) for full details.

**5.3 README**

- In [README.md](README.md), under "Tools & integrations", add: "OpenClaw gateway integration (send commands, history, abort) for steering a local OpenClaw instance from chat."

---

## Summary


| Area                    | Action                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Heap**                | Add optional **partIds** to registry so leaves can be named semantically (e.g. `agent_lifecycle`, `agent_openclaw` instead of `agent__part1`/`part2`). Structure the **agent** spec: ordered `toolNames`, **partIds: ["agent_lifecycle", "agent_openclaw"]**, **optionGroups**, and updated description.                                                          |
| **Credentials**         | Document env; optionally wire vault and document vault keys.                                                                                                                                                                                                                                                                                                      |
| **Unit tests**          | Sufficient coverage of unit-testable OpenClaw code: Heap (tool names, semantic part ids, optionGroups); execute-tool handlers — all branches for send_to_openclaw, openclaw_history, openclaw_abort; verify with test:coverage.                                                                                                                                   |
| **E2E**                 | Openclaw e2e: (1) Setup via create_sandbox with **alpine/openclaw** image (e.g. `alpine/openclaw:latest`; gateway pre-installed), expose port 18789. (2) Communicate (send_to_openclaw, openclaw_history). Skip when engine or image unavailable; fallback: expect OpenClaw error.                                                                                |
| **bind_sandbox_port**   | **Required.** Add **bind_sandbox_port** tool: runtime def (misc-tools or new module) + execute-tool handler calling site-bindings logic; returns host port (and optional WebSocket URL). E2E and agents use it to expose container port 18789.                                                                                                                    |
| **Multiple containers** | **Binding:** One sandbox per container; call bind_sandbox_port(sandboxId, 18789) per sandbox — each gets a distinct host port and WebSocket URL. **Targeting:** Optional gatewayUrl on the three OpenClaw tools. Document in openclaw-integration.md.                                                                                                             |
| **Docs**                | **Document the alpine/openclaw image** in (1) docs/openclaw-integration.md — image name, tags, pre-installed gateway, size, links, steps, **multiple containers** (distinct host ports, targeting via env or gatewayUrl); (2) official docs site — recommend alpine/openclaw as container image, link to internal doc. Also: Heap, credentials; README one-liner. |


---

## OpenClaw-related files (created or modified)

Single list of all files touched by this plan. **Unit tests** only touch test files and mocked code — no containers; **E2E** adds one test file that may skip when no container engine.

**Modified**

- [packages/runtime/src/chat/heap/registry.ts](packages/runtime/src/chat/heap/registry.ts) — partIds, agent spec (toolNames, partIds, optionGroups, description).
- [packages/ui/app/api/chat/_lib/execute-tool-handlers-workflows-runs-reminders.ts](packages/ui/app/api/chat/_lib/execute-tool-handlers-workflows-runs-reminders.ts) — OpenClaw handler branches; optional vault URL/token resolution.
- [packages/ui/__tests__/api/_lib/heap.test.ts](packages/ui/__tests__/api/_lib/heap.test.ts) — assertions for OpenClaw tools under agent, semantic part ids, optionGroups.
- [packages/ui/__tests__/api/_lib/execute-tool.test.ts](packages/ui/__tests__/api/_lib/execute-tool.test.ts) — OpenClaw handler tests (mocked client; no container).
- [docs/openclaw-integration.md](docs/openclaw-integration.md) — Heap, credentials, Running OpenClaw in a container, alpine/openclaw image.
- [README.md](README.md) — one-line OpenClaw under Tools & integrations.
- [apps/docs/content/](apps/docs/content/) — OpenClaw section or page (e.g. concepts/tools.mdx or capabilities.mdx), document alpine/openclaw image.

**New**

- [packages/ui/**tests**/e2e/openclaw.e2e.ts](packages/ui/__tests__/e2e/openclaw.e2e.ts) — E2E: optional container setup (alpine/openclaw) + communicate; skip when engine/image unavailable so CI is not required to run containers.

**Modified (bind_sandbox_port — required)**

- [packages/runtime/src/chat/tools/misc-tools.ts](packages/runtime/src/chat/tools/misc-tools.ts) (or new tool module) — add tool def `bind_sandbox_port` (sandboxId, containerPort, optional host). Export and include in combined tools list.
- [packages/ui/app/api/chat/_lib/execute-tool-handlers-workflows-runs-reminders.ts](packages/ui/app/api/chat/_lib/execute-tool-handlers-workflows-runs-reminders.ts) — add handler case for `bind_sandbox_port` (call site-bindings logic, return host port and optional WebSocket URL).

**Modified (multiple OpenClaw containers)**

- [packages/runtime/src/chat/tools/openclaw-tools.ts](packages/runtime/src/chat/tools/openclaw-tools.ts) — add optional **gatewayUrl** parameter to send_to_openclaw, openclaw_history, openclaw_abort (so agent can target a specific gateway when multiple containers are run).
- [packages/ui/app/api/chat/_lib/execute-tool-handlers-workflows-runs-reminders.ts](packages/ui/app/api/chat/_lib/execute-tool-handlers-workflows-runs-reminders.ts) — when `gatewayUrl` is present in args, pass it as `options.url` to the openclaw client in all three OpenClaw handler branches.

**Unchanged (reference only)**

- [packages/ui/vitest.config.ts](packages/ui/vitest.config.ts) — already excludes openclaw-client and api/openclaw/* from coverage.
- [packages/ui/app/api/_lib/openclaw-client.ts](packages/ui/app/api/_lib/openclaw-client.ts) — already supports `options.url`; no change. [packages/ui/app/api/openclaw/*](packages/ui/app/api/openclaw/) — no changes required for this plan; unit tests mock the client.

