# Plan: OpenClaw E2E — real scenario (agent steers OpenClaw)

## Goal

One e2e test that exercises a **real** scenario: the Studio chat assistant (agent) steers a **real** OpenClaw instance — send a command via `send_to_openclaw`, then verify via `openclaw_history` that OpenClaw actually responded. No mocks. The test **skips** when the OpenClaw Gateway is not reachable.

**CI:** In CI we do **not** run a real OpenClaw by default. So in normal CI the OpenClaw e2e will skip (no Gateway). If the e2e spawns containers (e.g. to run OpenClaw so the test can run), those containers **must** be cleaned up after the e2e tests finish so they do not pollute the system.

---

## Prerequisites (real scenario)

- **OpenClaw Gateway** must be running and reachable at `OPENCLAW_GATEWAY_URL` (default `ws://127.0.0.1:18789`) only when you want the OpenClaw e2e to run.
- **In CI:** No real OpenClaw is expected. The test skips when the Gateway is not reachable — so CI does not need to run OpenClaw unless we explicitly add a step that spawns a container for this test (and then must clean it up).
- When running the test locally (or in a pipeline that opts in): start the Gateway first, e.g. `openclaw gateway`, or run OpenClaw in a container and set `OPENCLAW_GATEWAY_URL`. If token auth is enabled, set `OPENCLAW_GATEWAY_TOKEN`.

### Full E2E (real send + history)

When the e2e **starts a container** (no Gateway on host), the container token typically has **no usable scopes** (gateway returns "missing scope: operator.read" or "operator.write"). Passing the test despite denied RPCs would be a failed test. So when the gateway was started in a container (`fromContainer`), the test **fails** with a clear message directing you to use a host gateway for full e2e. The e2e optionally runs `openclaw onboard --non-interactive ...` inside the container to try to obtain a token with full scopes; if the image supports it and the gateway hot-reloads that config, the test may pass with the container.

To get **full E2E** (real send, runId, and openclaw_history with messages), use **Option A: Host gateway** (see `docs/openclaw-integration.md` § Option A and `docs/openclaw-agent-command-execution-plan.md`):

1. On the host, run `openclaw onboard` (or ensure the gateway has a token with operator.write).
2. Start the gateway on the host: `openclaw gateway` (or your usual method).
3. Set `OPENCLAW_GATEWAY_URL` and `OPENCLAW_GATEWAY_TOKEN` to that gateway’s URL and token.
4. Run the OpenClaw e2e; it will see the gateway is reachable, **skip** starting a container, and use your gateway. The test will then assert runId and at least one message in history.

**Skip rule:** At the start of the test, call `openclawHealth()`. If the Gateway is not reachable, **skip** the test with a clear message.

---

## Real scenario: agent steers OpenClaw

1. **Check Gateway:** `openclawHealth()`. If not ok → skip test.
2. **Create conversation** (POST `/api/chat/conversations`).
3. **One chat turn** (POST `/api/chat?stream=1`, `useHeapMode: true`):  
   User message: *"Ask OpenClaw to say hello in one short sentence."*
4. **Read event stream** for that turn (GET `/api/chat/events?turnId=…`), find `type: "done"`, collect `toolResults`.
5. **Assert (both required):**
   - **send_to_openclaw** was called and the result indicates success (e.g. `runId` present, no `error`).
   - **openclaw_history (mandatory):** After a short wait (e.g. 3–5 s), call `openclaw_history` (via `executeTool("openclaw_history", {}, undefined)` or use the tool result from the turn if the chat already called it). **Mandatory:** Assert that `messages` has at least one message (e.g. at least one assistant message or non-empty content). This proves OpenClaw actually responded in the real scenario.
6. If the LLM never calls `send_to_openclaw`, the test fails. If the Gateway is down, we skip.

**Assertions:**

- `send_to_openclaw` in tool results and result has `runId` or no `error`.
- **Mandatory:** `openclaw_history` returns at least one message (either from the same turn's tool results or from a follow-up `executeTool("openclaw_history", ...)` after a short wait). Do not assert exact reply text to limit flakiness.

---

## If e2e spawns containers (e.g. OpenClaw): cleanup required

If we add logic to start OpenClaw (or any service) in a container so the OpenClaw e2e can run when no Gateway is already running:

- **beforeAll / in-test:** Start the container (e.g. `create_sandbox` with `alpine/openclaw:latest`, `bind_sandbox_port`, set `OPENCLAW_GATEWAY_URL`), wait for `openclawHealth()` with a timeout, then run the test. If startup fails, skip the test.
- **afterAll / teardown (mandatory):** **Always** tear down any container (sandbox) that the e2e started. Run cleanup after the e2e tests (e.g. in `afterAll` of the OpenClaw describe, or in a global afterAll that runs after all e2e tests). Containers spawned for e2e must not be left running — they would otherwise pollute the system (CI or local).

So: in CI we do not want a real OpenClaw running by default; if the test spawns a container to get a real OpenClaw, it must clean that container up when the e2e run is done.

---

## Implementation order

1. **OpenClaw e2e test** in `packages/ui/__tests__/e2e/openclaw.e2e.ts`:
   - Use `openclawHealth()`. If not ok, skip.
   - Create conversation → one heap chat turn with "Ask OpenClaw to say hello in one short sentence." → read events → assert `send_to_openclaw` in tool results and success.
   - **Mandatory:** Wait 3–5 s, then call `openclaw_history` (executeTool or use tool result from events) and assert `messages` has at least one message.
2. **Document:** "To run the OpenClaw e2e, start the OpenClaw Gateway first (e.g. `openclaw gateway` or run OpenClaw in a container and set OPENCLAW_GATEWAY_URL). In CI the test skips unless a Gateway is reachable."
3. **If adding container spawn:** Implement startup in beforeAll and **mandatory** teardown in afterAll so containers are always cleaned up after the e2e run.

---

## Summary

| Item | Detail |
|------|--------|
| CI | No real OpenClaw running by default; OpenClaw e2e skips when Gateway unreachable. |
| Scenario | Real only: real Gateway, real send, real history. No mock. |
| Flow | Create conversation → heap turn "Ask OpenClaw to say hello…" → assert send_to_openclaw succeeded → **mandatory:** assert openclaw_history has at least one message. |
| Assertions | send success + **mandatory** non-empty history (at least one message). No exact reply text. |
| Containers | If e2e spawns containers (e.g. OpenClaw), **must** clean them up after the e2e tests so they do not pollute the system. |
