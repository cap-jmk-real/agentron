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
* Did I run the build (and fix any errors)?

---

## Build Verification

After modifying code, **always run the relevant build(s)** to catch and fix potential build errors before considering the change complete.

- **Default:** Run `npm run build:ui` when changing app/UI, packages/ui, packages/core, or packages/runtime code.
- **Docs:** Run `npm run build:docs` when changing anything under `apps/docs/`.
- **Typecheck:** Run `npm run typecheck` when changing TypeScript; fix type errors before finishing.
- If the build or typecheck fails, fix the errors and re-run until they pass. Do not leave broken builds.

---

## Release & Tagging Rules

- **Never create or push tags unless the user explicitly asks for a release.**

- **When preparing a release (vX.Y.Z):**
  1. **Choose a semantic version** (X.Y.Z):
     - **Major (X)**: breaking changes
     - **Minor (Y)**: new features, backwards compatible
     - **Patch (Z)**: bug fixes or small improvements
  2. **Update all relevant `version` fields** to `X.Y.Z` (no `v` prefix):
     - `package.json` (root)
     - `apps/desktop/package.json`
     - `apps/docs/package.json`
  3. **Run tests and builds** before tagging:
     - `npm test` (or the project’s test command)
     - `npm run build:ui`
     - `npm run build:docs`
  4. **Commit the version bumps** with a clear message, e.g. `chore(release): vX.Y.Z`
  5. **Create an annotated tag** matching the version: `git tag -a vX.Y.Z -m "vX.Y.Z"`
  6. **Push branch and tag** only when the user asks: `git push origin <branch>` then `git push origin vX.Y.Z`

- **Consistency:** Do **not** create a `vX.Y.Z` tag if any of the above `package.json` files still have a different `version`. Align versions first.

- **CI:** Pushing a `v*` tag triggers the desktop release workflow (installers on GitHub Releases). Pushing to the default branch triggers the docs deploy to GitHub Pages.

## Promopt Generation

*