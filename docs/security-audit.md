# Dependency Security Audit

This document summarizes the state of `npm audit` and the measures taken to reduce risk.

## Measures Taken

### Overrides (root `package.json`)

The following overrides force patched versions across the dependency tree:

- **fast-xml-parser** `^5.3.5` — Mitigates critical DoS/entity expansion and entity encoding bypass (used by `@aws-sdk/xml-builder`).
- **tar** `^7.5.8` — Mitigates arbitrary file read/write via symlink (used in electron/rebuild chain).
- **qs** `^6.14.2` — Mitigates DoS via arrayLimit (used by express, googleapis).
- **hono** `^4.11.10` — Timing hardening in basicAuth/bearerAuth (transitive via `@modelcontextprotocol/sdk`).
- **glob** `^10.2.2` — ReDoS fix (used by rimraf, gaxios, electron-builder chain).
- **rimraf** `^5.0.0` — Prefer version that uses safe glob.

### Upgrades

- **@electron/rebuild** `^4.0.0` and **electron-builder** `^26.8.1` — Reduces exposure in desktop build chain (node-gyp, make-fetch-happen, asar, minimatch).
- **Docs**: Docusaurus replaced with **Nextra 4** — Removes serve-handler/minimatch chain from the docs app.

### Deferred (not applied)

- **ESLint 10** — Migration deferred; current config/plugins (e.g. eslint-config-next, eslint-plugin-react) are not yet compatible; minimatch/ajv remain in ESLint tree.
- **Vitest 4** — Not upgraded; coverage thresholds and behavior differ; glob/minimatch remain in coverage tooling.

## Remaining Advisories (documented exceptions)

After overrides and upgrades, `npm audit` may still report:

| Area | Reason |
|------|--------|
| **minimatch** (high, ReDoS) | Deep in ESLint, electron-builder, @electron/asar, glob. Override for glob helps where glob is the direct dep; ESLint 10 and electron-builder upgrades would reduce further. |
| **ajv** (moderate, ReDoS with $data) | In ESLint / @eslint/eslintrc. Addressed by ESLint 10 migration when feasible. |
| **esbuild** (moderate, dev server) | In apps/desktop; fix is major upgrade. Dev-only; not in production runtime. |
| **fast-xml-parser / qs / tar / hono** | Overrides should force safe versions; audit output can still list older transitive paths until all consumers resolve. |

## CI

- **Audit**: CI runs `npm audit --audit-level=critical` with `continue-on-error: true` so existing critical (e.g. fast-xml-parser in transitive tree) does not block merges. Overrides are in place; once the lockfile or tooling fully reflects them, consider removing `continue-on-error` so CI fails on new critical issues.
- **Build**: `npm run build:docs` runs in CI to ensure the Nextra docs app builds.

## Keeping This Updated

When adding or upgrading dependencies, run `npm audit` and update this file if new advisories are accepted or new overrides are added.
