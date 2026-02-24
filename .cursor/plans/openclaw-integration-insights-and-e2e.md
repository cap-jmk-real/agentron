# OpenClaw integration: insights, module option, and e2e recommendations

## Insights from the e2e work

1. **Log analysis is essential**  
   Real bugs (e.g. `models.providers.ollama.models` required array, `models.defaults` invalid) were only found when container logs were inspected. The e2e now dumps the last 80 lines of `podman logs` on any test failure so future failures can be diagnosed without manual log capture.

2. **OpenClaw config schema is strict and easy to break**  
   Patching `openclaw.json` with inline Node scripts (base64-encoded) is fragile: a small schema change (new required field, renamed key) can invalidate the config and the gateway reports "Config invalid". Keeping the exact expected shape in one place and aligning with [OpenClaw provider/config docs](https://docs.openclaw.ai/providers/ollama) reduces drift.

3. **Two integration paths**  
   - **Host path:** Gateway on host; URL/token from vault or env; `openclaw-client` talks to gateway over WebSocket.  
   - **In-container path:** Gateway in sandbox; RPC runs via `podman exec` inside the container (connect to `127.0.0.1:18788`); no port binding needed; requires correct connect-then-RPC handshake and quoting for Windows (PowerShell) and container `sh`.

4. **Ollama config must match OpenClaw’s schema**  
   Provider needs `baseUrl`, `apiKey`, `api: "openai-responses"`, and **`models: []`** (array required). There is no top-level `models.defaults`; agent model is set via **`agents.defaults.model.primary`** only. E2E reuses the same Ollama config as other e2e tests (`OLLAMA_BASE_URL`, `E2E_LLM_MODEL`) and the container reaches the host via `host.containers.internal`.

5. **Test must require real success**  
   The e2e only passes when we get a `runId` and at least one message from OpenClaw (using Ollama). No “pass on skip” or “pass with 0 messages,” so the test stays meaningful.

---

## Is a proper Node module worthwhile?

**Consolidate: yes.** **Publish a new npm package: only if you need it outside this repo.**

- **Recommended:** Extract OpenClaw container config and patch logic into a **single internal module** (e.g. `packages/ui/app/api/_lib/openclaw-container-config.ts` or a small `packages/openclaw-config/` if you want it reusable across packages). That module would:
  - Build the gateway + proxy patch script and the Ollama patch script (with correct schema: `models.providers.ollama` with `models: []`, no `models.defaults`, `agents.defaults.model.primary`).
  - Expose a function like `getOpenClawSandboxConfig(env: { OPENCLAW_E2E_TOKEN?, OPENCLAW_AGENT_MODEL?, OPENCLAW_OLLAMA_BASE_URL? })` used by the create_sandbox handler and e2e.
  - Be the single place to update when OpenClaw changes config shape; unit-test the builder with a mock config to catch schema drift.

- **Publishing a separate npm package** (e.g. `@agentron/openclaw-sandbox-config`) is only worth it if multiple projects or the OpenClaw ecosystem will depend on it. For one app and one e2e flow, an internal module is enough.

---

## Other e2e tests to run with OpenClaw (to make integration easy)

| Test | Purpose |
|------|--------|
| **Smoke: create_sandbox + exec + tear down** | Minimal test: start OpenClaw container with our config, run one `podman exec` (e.g. `printf ok`), tear down. Fast signal that Podman + image + config work. Could be a separate `it()` or a shared helper used by the main e2e. |
| **openclaw_abort with sandboxId** | Create sandbox, send a message, call `openclaw_abort` with `sandboxId`, assert success. Ensures the in-container path works for abort as well as send/history. |
| **Host path (no sandbox)** | When `OPENCLAW_GATEWAY_URL` and token are set (or vault), run the same “send then history” flow against the host gateway. Validates URL/token path and `openclaw-client` when the gateway is external. Can be a separate `it()` or a branch in the same test when no sandbox is created. |
| **Port binding + host path** | Create OpenClaw sandbox with Ollama, bind container port 18789 to a host port, set vault URL to `localhost:<port>`, run chat using the host path (no `sandboxId`). Ensures the proxy port and host-path integration work together. |
| **History limit and ordering** | Send two messages, call `openclaw_history` with `limit: 5`, assert at least two messages and ordering. Exercises history API and limit. |
| **Error cases** | `send_to_openclaw` with empty content returns error; `openclaw_history` with invalid or non-OpenClaw `sandboxId` returns a clear error. Some of this may exist in `execute-tool.test.ts`; e2e can add one “invalid sandboxId returns clear error” for the handler contract. |
| **Config schema regression** | Unit test (no container): build the patch config or run the patch script against a mock quickstart config and assert the result has the expected shape (e.g. `models.providers.ollama.models` is an array, no `models.defaults`). Catches OpenClaw schema drift without starting Podman. |

Implementing the smoke test and `openclaw_abort` e2e gives the most value for little effort; host-path and port-binding tests are next for full coverage of the integration surface.

---

## Complicated e2e use cases (stress the integration)

These scenarios go beyond “send one message, get history” and catch real-world bugs: session continuity, routing, concurrency, and integration with the rest of the stack.

| Use case | What to do | What it proves |
|----------|------------|----------------|
| **Multi-turn with OpenClaw** | Send “Say hello.” → assert history has reply → send “Now reply with exactly one word.” → assert history has two assistant messages and the second is one word (or at least different). | Session/context is maintained across multiple send_to_openclaw + openclaw_history cycles; default sessionKey and ordering work. |
| **OpenClaw interleaved with other tools** | One chat turn: prompt the agent to call send_to_openclaw, then list_agents, then openclaw_history. Assert toolResults contain all three and openclaw_history returns messages. | Agent can mix OpenClaw with other tools in one turn; no cross-talk or wrong sandboxId. |
| **Structured or constrained reply** | Send “Reply with only the three letters A, B and C in that order.” Assert the last message in history contains “A”, “B”, “C” (or matches a simple pattern). | Round-trip preserves intent and we assert on content, not just “≥1 message”. |
| **Two sandboxes, two sessions** | Create two OpenClaw sandboxes (two containers). Send “Say alpha” to sandboxId A and “Say beta” to sandboxId B. Get history from A and from B. Assert A’s history mentions alpha and B’s mentions beta. | sandboxId correctly routes to the right container; no shared session between sandboxes. |
| **Abort then send again** | Send a message, get runId. Call openclaw_abort with sandboxId (and optionally runId). Send a new message, get history. Assert we get a reply for the second message (and optionally that the first run was aborted). | Abort doesn’t break the session; we can send again after abort. |
| **Rapid send + history** | Send a message, immediately call openclaw_history (no long wait). Poll a few times with short delay. Assert we eventually get ≥1 message. | Handles “history before model finished”; no race or connection limit under quick succession. |
| **Content edge cases** | Send a message with quotes, newlines, or non-ASCII (e.g. “Say: hello\nworld and «test»”). Assert the reply appears in history and no encoding/parsing error. | Content is passed and stored correctly; no breakage on special characters. |
| **OpenClaw inside a workflow** | If a workflow step can call OpenClaw (or a tool that uses it): create a small workflow that does “send_to_openclaw” (or equivalent), run it, assert the step succeeds and downstream steps see the result. | Integration with workflow engine and tool execution in workflow context. |
| **History limit and order** | Send message 1, then message 2. Call openclaw_history with limit: 5. Assert we get at least 2 assistant messages and that the most recent is for message 2 (e.g. by content or order). | History limit and ordering are correct; we’re not missing or reordering messages. |
| **Error then success (same sandbox)** | Call send_to_openclaw with empty content for sandboxId → expect error. Then send_to_openclaw with valid content for same sandboxId → expect runId. Then openclaw_history → expect messages. | One bad call doesn’t break the session; clear errors and recovery. |

**Suggested order to add:** Start with **multi-turn** and **OpenClaw interleaved with other tools** (both are one extra prompt/assertion on top of the current e2e). Then **two sandboxes** (routing) and **abort then send again** (abort lifecycle). **Structured reply** and **content edge cases** are small additions; **workflow** depends on how workflows invoke OpenClaw today.
