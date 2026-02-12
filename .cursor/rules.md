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
  * Expected coverage: **~90x   x       –100%**

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

* **Run coverage (UI):** From repo root run `npm run test:coverage --workspace packages/ui`, or from `packages/ui` run `npm run test:coverage`. This runs the test suite with the V8 coverage provider and prints a text summary in the terminal.
* **Reports:** A summary (statements, branches, functions, lines) is printed after the run. An HTML report is written to `packages/ui/coverage/`; open `packages/ui/coverage/index.html` in a browser for per-file, line-by-line coverage.
* **When to run:** Run coverage when adding or changing tests, when touching critical paths, or before pushing (alongside `npm test`). CI runs tests with coverage in the docs and desktop workflows; the coverage report is uploaded as an artifact.
* **Interpretation:** Use the summary and HTML report to find uncovered lines and branches. Treat coverage as a risk signal (see Coverage Expectations above); acknowledge and justify gaps. No coverage threshold is enforced in CI; the goal is visibility and informed decisions.

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

---

### Self-Review Before Finalizing

Before presenting code, the agent asks:

* What could break silently?
* What assumptions are encoded in tests?
* Are critical paths protected by unit tests?
* Are boundaries validated by integration tests?
* Did I run the unit tests?
* Did I run the test coverage (`npm run test:coverage --workspace packages/ui`) and check the report?
* Did I run the build (and fix any errors)?
* Before pushing: did I run the docs build locally (`npm run build:docs`) so the docs deploy does not break?
* Before pushing: did I run the app (UI) build locally (`npm run build:ui`) so the release/PR build does not fail in CI?
* Before pushing: did I run the Electron (desktop) app build locally (`npm run build:ui` then `npm run dist --workspace apps/desktop`) so the desktop release workflow does not fail in CI?

---

## Build Verification

After modifying code, **always run the relevant build(s)** to catch and fix potential build errors before considering the change complete.

- **Default:** Run `npm run build:ui` when changing app/UI, packages/ui, packages/core, or packages/runtime code.
- **Docs:** Run `npm run build:docs` when changing anything under `apps/docs/`.
- **Desktop (Electron):** When changing `apps/desktop` or anything the desktop app depends on, run `npm run build:ui` then `npm run dist --workspace apps/desktop` to verify the Electron build and installer packaging.
- **Before pushing:** Run locally before pushing as relevant:
  - `npm test` — so CI tests pass.
  - `npm run test:coverage --workspace packages/ui` — run coverage and review the report (see *How to evaluate coverage* in Testing Strategy).
  - `npm run build:docs` — so the docs build (and GitHub Pages deploy) does not fail in CI.
  - `npm run build:ui` — so the UI build does not fail in CI.
  - `npm run dist --workspace apps/desktop` (after `npm run build:ui`) — so the Electron/desktop release workflow does not fail in CI.
- **Typecheck:** Run `npm run typecheck` when changing TypeScript; fix type errors before finishing.
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

## Promopt Generation

*