**Canonical rules:** All Cursor rules for this repo live in **`.cursor/rules/*.mdc`** (this folder). Clone the repo and open it as the workspace root — Cursor will load these rules for you and any other dev/machine. This file is a long-form reference; the .mdc rules are what Cursor uses for scoping.

---

## UI Style Guide

When working on the UI (especially `packages/ui/app/` and `packages/ui/app/globals.css`), follow this guide for consistency and maintainability.

### Styling: separate from components, prefer global CSS

- **Prefer global CSS over inline styles.** Put styles in `globals.css` (or a dedicated CSS module) and use class names on elements. Avoid `style={{ ... }}` except for truly dynamic values (e.g. a computed width or visibility that depends on props/state).
- **Separate styling from component logic.** When using React (or any UI framework), keep layout and visual styling in CSS files; keep components focused on structure, behavior, and class names. This improves maintainability, reuse, and theming.
- **Use semantic class names.** Prefer `.chat-input-bar`, `.canvas-container`, `.card-header` over generic or inline styles so that global CSS remains the single place to change appearance.
- **Inline styles only when necessary.** Reserve inline styles for values that must be computed at render time (e.g. `width: ${percent}%`, `display: loading ? 'none' : 'block'`). Everything else should be in CSS.

### Design tokens

Use CSS variables only: `--bg`, `--surface`, `--surface-muted`, `--text`, `--text-muted`, `--primary`, `--primary-strong`, `--border`, `--shadow`, and sidebar tokens. Do not introduce new hex/rgba for backgrounds, text, or primary actions.

### Layout and chat

- Header (topbar) must align with the top of the sidebar; content area should not overlap it (use appropriate z-index and flex order).
- Chat and other sections should use the same radius scale (6–10px) and surface tokens. Safe API data in UI: guard with `Array.isArray(data.x) ? data.x : []` before `.map()`.

---

## Testing Strategy & Coverage Expectations

### Testing Philosophy

Testing exists to:

* Encode expected behavior
* Prevent regressions
* Enable safe refactoring
* Reduce uncertainty during change

Tests are **not written for vanity metrics**, but coverage is used as a **risk signal**.

---

### Coverage Expectations

* **Critical business logic**:

  * Must be covered by **unit tests**
  * Expected coverage: **~90–100%**

* **Non-critical logic / glue code**:

  * Reasonable coverage, prioritizing behavior over lines
* **Infrastructure, framework wiring, trivial getters/setters**:

  * Coverage optional if behavior is implicitly tested elsewhere

Coverage gaps must be:

* Explicitly acknowledged
* Justified with a reason
* Marked as technical risk if relevant

Coverage should:

* Focus on **branches, edge cases, and failure modes**
* Avoid testing implementation details
* Avoid brittle tests that block refactoring

---

### How to evaluate coverage

* **Run coverage (UI):** From repo root run `npm run test:coverage` (or `pnpm run test:coverage`), or from `packages/ui` run `npm run test:coverage`. This runs the test suite with the V8 coverage provider and prints a text summary in the terminal.
* **Reports:** A summary (statements, branches, functions, lines) is printed after the run. An HTML report is written to `packages/ui/coverage/`; open `packages/ui/coverage/index.html` in a browser for per-file, line-by-line coverage.
* **When to run:** Run coverage when adding or changing tests, when touching critical paths, or before pushing (alongside `npm test`). CI runs tests with coverage in the docs and desktop workflows; the coverage report is uploaded as an artifact.
* **Interpretation:** Use the summary and HTML report to find uncovered lines and branches. Treat coverage as a risk signal (see Coverage Expectations above); acknowledge and justify gaps. No coverage threshold is enforced in CI; the goal is visibility and informed decisions.

---

### No LLMs in tests when possible (testing paradigm)

Tests must run **without real LLM calls** wherever the behavior under test is code paths, data flow, or tool execution. Use **deterministic inputs and mocks** so we know the code works regardless of model variance.

- **Mock in tests:** Router output (fixed `priorityOrder` + `refinedTask`). Specialist runs: mock `runSpecialist` / LLM to return fixed content or tool_calls. Tool handlers: real or in-process mocks with deterministic responses. Heap runner, registry, validation, context merge, and chat-route branching are tested with **no live LLM provider**.
- **Statistical behavior in production:** Non-deterministic LLM output is handled by **human-in-the-loop** (user confirms goal, gives feedback) and **self-improvement** (improver updates prompts/specialists from run logs and feedback). Tests do **not** rely on "good" or "bad" LLM output; they rely on fixed mock responses.
- **When an LLM might appear in tests:** Only for tests that explicitly assert "router or specialist produces valid JSON" or "refine produces a suggestion" from a **single canned prompt/response** (e.g. fixture response from a file). Prefer still mocking the LLM client so the test stays deterministic and fast.
- **Improvement / planner / heap tests:** Mock `get_run_for_improvement` with fixture run + logs; mock the improver’s or planner’s LLM to return a fixed plan or update payload. Assert flow and DB updates, not model quality.

Apply this when writing or reviewing tests for: heap runner, chat route (heap mode), improvement workflow, improvement-planning specialist, run-improve loop.

---

### Unit Tests (Default)

Unit tests are the **default testing tool**.

The agent should:

* Write unit tests for all core functions and modules
* Test:

  * Happy paths
  * Edge cases
  * Invalid input
  * Error handling
* Prefer:

  * Deterministic tests
  * Minimal mocking
  * Clear, readable assertions

Unit tests should:

* Run fast
* Be isolated
* Fail loudly and clearly
* Enable confident refactoring

If code cannot be unit-tested easily:

* Refactor the code
* Or explicitly call out why it is hard to test

---

### Integration Tests (Selective & Intentional)

Integration tests are used when:

* Multiple components interact
* External systems are involved (DB, filesystem, network, APIs)
* Behavior cannot be meaningfully validated in isolation

The agent should:

* Clearly label integration tests
* Limit scope to **real interaction boundaries**
* Prefer real dependencies over heavy mocks when feasible
* Avoid duplicating unit test coverage

Integration tests should validate:

* Data flow
* Configuration correctness
* Contract compatibility
* Failure behavior at boundaries

---

### Test Maintenance Rules

Whenever code behavior changes:

* Update or add tests accordingly
* Remove obsolete tests
* Ensure test names still reflect behavior

**When fixing a bug:** Add (or update) a corresponding test that would have failed before the fix and passes after it, so the same bug cannot recur. See `.cursor/rules/bug-fix-add-tests.mdc` for details.

Failing tests are treated as:

* A signal of incorrect code **or**
* A signal of outdated assumptions
  Both must be resolved explicitly.

---

### Definition of Done (Testing)

Work is **not complete** unless:

* Core logic is unit-tested
* Edge cases and failure modes are covered
* Integration tests exist where boundaries matter
* Coverage gaps are intentional and explained
* Tests for heap, improvement, or assistant paths use **deterministic mocks** (no real LLM) when testing code flow; statistical behavior is left to human-in-the-loop and self-improvement in production

---

### Self-Review Before Finalizing

Before presenting code, the agent asks:

* What could break silently?
* What assumptions are encoded in tests?
* Are critical paths protected by unit tests?
* Are boundaries validated by integration tests?
* For heap/improvement/assistant tests: did I use deterministic mocks (no real LLM) so the test verifies code flow, not model output?
* Did I run the unit tests?
* Did I run the test coverage (`npm run test:coverage`) and check the report?
* Did I run the build (and fix any errors)?
* Before pushing: did I run `npm run pre-push` (or all CI steps: typecheck, lint, test, build:ui, build:docs, desktop dist) locally to save CI minutes?

---

## Build Verification

After modifying code, **always run the relevant build(s)** to catch and fix potential build errors before considering the change complete.

- **Before pushing:** Run `npm run pre-push` to run all CI steps locally (typecheck, lint, test, build:ui, build:docs, desktop dist) and avoid wasting CI minutes. If the desktop build fails with "file is being used", close Agentron Studio, any Explorer windows showing `apps/desktop/release/`, and restart Cursor so the watcher excludes take effect (see `.vscode/settings.json`).

- **Default:** Run `npm run build:ui` when changing app/UI, packages/ui, packages/core, or packages/runtime code.
- **Docs:** Run `npm run build:docs` when changing anything under `apps/docs/`.
- **Desktop (Electron):** When changing `apps/desktop` or anything the desktop app depends on, run `npm run build:ui` then `npm run dist --workspace apps/desktop` to verify the Electron build and installer packaging.
- **Before pushing:** Run `npm run pre-push` so all CI checks pass locally and CI minutes are not wasted.
- If the build or typecheck fails, fix the errors and re-run until they pass. Do not leave broken builds.

---

## Release & Tagging Rules

- **Releases are created only when merging to `main`.** The version comes from `package.json`; a GitHub Release with desktop installers is created for `v{version}`. The desktop build runs on PRs to verify the app builds before merge; the release is created only after merge to `main`.

- **When preparing a release (vX.Y.Z):** The agent bumps the version in the package files **before** the user pushes to the branch that will be merged.
  1. **Bump version** (updates `package.json`, `apps/desktop/package.json`, `apps/docs/package.json`): run `npm run release:bump` (or `-- minor` / `-- major`). Include the bumped version in the commit so it is part of the PR before merge.
     - Patch (bug fixes): `npm run release:bump` or `npm run release:bump -- patch`
     - Minor (new features): `npm run release:bump -- minor`
     - Major (breaking): `npm run release:bump -- major`
  2. **Run tests and builds** before pushing:
     - `npm test`
     - `npm run build:ui`
     - `npm run build:docs`
     - Or use `npm run release:prepare` (bump patch + test + UI build + docs build)
  3. **Commit** with a clear message: `git add -A && git commit -m "chore(release): vX.Y.Z"`
  4. **Merge to `main`** (via PR or push). The desktop release workflow runs automatically and creates a GitHub Release with installers.

- **Consistency:** Each merge to `main` must have a version bump. If you merge twice without bumping, the second release will fail (duplicate tag). The `release:bump` script keeps root, `apps/desktop`, and `apps/docs` versions aligned.

- **CI:** PRs to `main` run the desktop build (to verify the app builds). Merging to `main` creates the GitHub Release with installers and deploys docs.

---

## Chat assistant specialist structure (multi-agent / heap)

When editing the **assistant agent specialist structure** (tool sets per specialist, specialist registry, router, or chat route that runs them):

- **Cap: No more than 10 tools per specialist.** If a domain would exceed 10 tools, split it into sub-specialists (e.g. Workflow → "Workflow definition" + "Run control"). Applies to any file that defines or registers per-specialist tool sets (e.g. `packages/runtime/src/chat/tools/`, specialist registry, chat route).
- **Logging:** Add traceable execution logging so the assistant stack can be followed in logs. Use a single **trace id** per chat turn; log at **router** (priorityOrder, refinedTask summary), **specialist** (specialistId, start/end), **tool** (toolName, result/error), and when a specialist **delegates** (delegateHeap, depth) with the same trace id. Prefer structured key=value or JSON so logs can be filtered. See `.cursor/rules/assistant-specialist-structure.mdc` for full details.
- **Delegators / deep heap:** Specialists can act as delegators by returning a sub-heap (`delegateHeap`); the runtime runs it with a heap stack and depth limit before continuing the parent heap. No extra "invoke specialist" tool; cap 10 tools per specialist still applies.
- **Recursive prompts:** Do not overload any LLM with all specialist descriptions. Router gets only **top-level** specialist ids (small list); each delegator gets only its **delegateTargets** (sub-specialists it can delegate to). Scoped lists per node keep prompts short.
- **Small choice set at every level:** Too many specialist options at once hurts decisions (same as too many tools). Cap **branching factor**: router top-level list ≤ 7; each delegator's `delegateTargets` ≤ 7. If you have more sub-specialists, add an intermediate layer (group into meta-specialists) so no LLM ever sees "choose one of 12."

---

## Chat assistant & tools: reduce LLM usage

When **adding or changing chat assistant tools** (e.g. in `packages/ui/app/api/chat/route.ts` executeTool, or runtime tools used by the assistant), **evaluate whether a server-side or “skip-LLM” path makes sense** and implement it when it does.

### Why

- Every rephrase and every assistant turn costs tokens and latency.
- User actions that are **deterministic** (e.g. “run this command”, “yes delete these”, “add to allowlist”) do not need the LLM to “decide” again; the server can execute and then hand a single, clear message to the LLM for the next step.

### Patterns already in use

1. **Shell approval**  
   User clicks “Approve & Run” → server runs the command via `/api/shell-command/execute`; client sends `continueShellApproval: { command, stdout, stderr, exitCode }` → chat route skips rephrase and builds a short effective message; one assistant call continues the conversation.

2. **Delete confirmation**  
   Last assistant turn had `list_agents` + `list_workflows` + `ask_user` with options; user sends the first (affirmative) option → server runs `delete_agent` / `delete_workflow` for the listed ids, then injects a single message (“User confirmed. Deletions done. Now create …”) → one assistant call does creation/wiring only.

3. **Synthetic messages**  
   Messages that are system-generated (e.g. “The user approved and ran: …”, “Added … to the allowlist”) or short non-questions skip rephrase via `shouldSkipRephrase()`.

### Rule for new or changed tools

When you **create or significantly change** a chat assistant tool:

1. **Evaluate**
   - Does this tool sometimes require **user confirmation** (e.g. approval, “Yes/No” choice)?
   - After the user confirms, is the **next step deterministic** (e.g. “run X”, “delete these”, “add to list”)?
   - If yes: consider a **confirmation path**: server detects the confirmation (e.g. from last assistant tool results + user message), runs the deterministic actions (same tool executor), then calls the assistant once with a single injected message so the LLM only does the *next* logical step (e.g. create, summarize, offer options).

2. **Implement when it makes sense**
   - Add detection (e.g. last assistant message’s tool results + user message matching an option).
   - Run the tool(s) server-side in the chat route (reuse `executeTool` or the same logic).
   - Build a short, explicit `effectiveMessage` and set a flag (e.g. `confirmationPathMessage`) so the route skips rephrase and uses this message for one assistant call.
   - Document the pattern in this section or in code comments so future tools can follow it.

3. **Do not** add server-side paths for actions that are **not** deterministic (e.g. “interpret what the user meant” or “choose from many valid next steps”). Those remain LLM-driven.

### Where to wire this

- **Chat route:** `packages/ui/app/api/chat/route.ts` — payload handling, `effectiveMessage` branches, and any “confirmation path” logic (e.g. `continueShellApproval`, delete-confirm).
- **Runtime tools:** `packages/runtime/src/chat/tools/` — tool definitions and prompts; keep tool contracts stable so the route can rely on result shapes (e.g. `list_agents` / `list_workflows` + `ask_user` with `options`) for detection.

---

## Prompt generation

(Reserved for future prompt-generation rules.)