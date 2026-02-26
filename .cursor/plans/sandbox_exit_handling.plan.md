# Sandbox exit handling: required immediate-exit + surfacing "exited later"

## 1. Make immediate-exit detection required (not optional)

**create_sandbox** must always, immediately after `podman.create()`, check whether the container is still running:

- Call `getContainerState(containerId)` (already exists in [packages/runtime/src/sandbox/podman.ts](packages/runtime/src/sandbox/podman.ts)).
- If state is not `"running"` (e.g. `"exited"`, `"dead"`), treat as **immediate exit**:
  - Do **not** persist `status: "running"` in the DB; persist `"stopped"` (or equivalent).
  - Return the same **exit diagnostics** shape as below (state, exitCode, oomKilled, logs tail, hint) so the assistant gets a clear, actionable response.

No "optional" branch: this check is mandatory on every create_sandbox.

---

## 2. Single exit-diagnostics path (create_sandbox + execute_code)

Whenever we detect "container not running" (either right after create or when handling execute_code), we use one consistent response shape so the assistant always gets:

- **state** – e.g. `"exited"`, `"dead"`
- **exitCode** – from container inspect (e.g. 139 for segfault, 137 for OOM/sigkill)
- **oomKilled** – boolean from inspect (if true, hint can mention memory)
- **logs** – tail of container logs (e.g. last 50 lines) for debugging
- **hint** – short message: e.g. "Container exited. Recreate the sandbox with create_sandbox or start the container if your engine supports it."

Implementation:

- **Podman (runtime):** Add `getContainerExitInfo(containerId): Promise<{ exitCode: number; oomKilled: boolean }>` using `podman inspect --format '{{.State.ExitCode}} {{.State.OOMKilled}}'` and parsing the output. Use existing `logs(containerId, tail)` for log tail. Expose this from the container manager used by the UI (see next).
- **UI handler:** The sandbox handler in [packages/ui/app/api/chat/_lib/execute-tool-handlers-sandbox.ts](packages/ui/app/api/chat/_lib/execute-tool-handlers-sandbox.ts) already uses `getContainerManager()` and `getContainerState()`. When state !== `"running"`:
  - Call the new exit-info API (and logs) from the container layer used by the UI (if the UI wraps the runtime's podman, the wrapper may need to expose getContainerExitInfo and logs; otherwise use the same inspect/logs calls in the UI's container layer).
  - Return a structured result: e.g. `{ error?, state, exitCode, oomKilled?, logs?, hint, stdout: "", stderr: "<summary>", exitCode }` so tool result and run-workflow handling can show a clear message and optional logs.

Apply this path in two places:

1. **create_sandbox** – right after create, if immediate-exit detected (as above).
2. **execute_code** – when `getContainerState(sb.containerId) !== "running"` (replace the current minimal message with this diagnostics shape).

---

## 3. Inspect-sandbox tool (check if container is running)

Add a tool that allows **inspection of a sandbox** to see whether its container is running, without running a command inside it.

- **Name:** `get_sandbox` or `inspect_sandbox` (pick one; `get_sandbox` aligns with other get_* tools in the codebase).
- **Parameters:** `sandboxId` (required).
- **Behavior:**
  - Look up sandbox by id in DB; if not found return `{ error: "Sandbox not found" }`.
  - If no `containerId`, return sandbox metadata (id, name, image, status from DB) and e.g. `containerState: null` or `message: "Sandbox has no container"`.
  - Otherwise call `getContainerState(containerId)`.
  - If **running:** return `{ id, name, image, status: "running", containerState: "running" }` (and any other useful metadata from DB).
  - If **not running:** call the same exit-diagnostics path (getContainerExitInfo + logs), return `{ id, name, image, status: "exited" | "stopped", containerState, exitCode, oomKilled?, logs?, hint }` so the assistant can report why the container stopped.

**Why this helps:**

- The assistant can proactively check "is this sandbox still alive?" before or after a long operation.
- Single place to get current state and exit diagnostics without calling execute_code (which would fail when the container is exited).
- Complements **list_sandboxes** (overview of all) with on-demand **get_sandbox(id)** (detailed state of one).

**Implementation:** Add handler case in [execute-tool-handlers-sandbox.ts](packages/ui/app/api/chat/_lib/execute-tool-handlers-sandbox.ts); add tool definition in runtime (e.g. [packages/runtime/src/chat/tools/misc-tools.ts](packages/runtime/src/chat/tools/misc-tools.ts) or where list_sandboxes is defined) and in UI db tool schema if applicable. Reuse the same exit-diagnostics helper used by create_sandbox and execute_code.

---

## 4. Surfacing "exited later"

**When do we surface that the container exited later?**

- **Today:** We only notice when the user/assistant next calls **execute_code**. At that moment we return a short message and no exit code/logs.
- **After this plan:** We surface "exited later" in two ways:
  1. **execute_code** – when they next run a command, we return **full diagnostics** (state, exitCode, oomKilled, logs, hint) via the single path above.
  2. **get_sandbox(sandboxId)** – the assistant (or user) can call the new inspect tool to check a sandbox's state anytime. If the container has exited, the tool returns the same diagnostics without needing to run a command.

**Optional:** **list_sandboxes** could refresh each sandbox's status from the container (getContainerState per row) and show `"exited"` with optional `exitCode` in the list, so the assistant sees "sandbox X: exited" without calling get_sandbox or execute_code. Can be added later if desired.

---

## 5. Summary

| Topic | Decision |
|-------|----------|
| create_sandbox immediate-exit | **Required.** Always check state after create; if not running, persist stopped and return full exit diagnostics. |
| Exited later – when surfaced | On the **next execute_code** (full diagnostics), and via **get_sandbox(sandboxId)** so the assistant can inspect without running a command. |
| Inspect tool | **get_sandbox(sandboxId)** – returns current container state; when not running, returns same exit diagnostics (exitCode, oomKilled, logs, hint). |
| Diagnostics shape | One path: state, exitCode, oomKilled, logs tail, hint; used for create_sandbox immediate exit, execute_code when exited, and get_sandbox when exited. |
