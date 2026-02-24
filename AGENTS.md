# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

Agentron Studio is a local-first AI agent orchestration platform. The only required service is the **Next.js UI** (`packages/ui`), which bundles all API routes, SQLite DB, and agent runtime in a single process.

### Services

| Service | Start command | Port | Notes |
|---------|--------------|------|-------|
| Next.js UI (dev) | `npm run dev:ui` | 3000 | Core service — all API routes + UI |

### Key commands

See `package.json` scripts for the full list. Commonly used:

- **Dev server:** `npm run dev:ui` (port 3000)
- **Lint:** `npm run lint:ui`
- **Typecheck (all):** `pnpm run typecheck` (must use `pnpm`, not `npm`, to get correct workspace script resolution)
- **Tests:** `npm test`
- **Tests with coverage:** `npm run test:coverage`
- **Format:** `pnpm run format` / `pnpm run format:check`
- **Build UI:** `npm run build:ui`
- **Full CI-local:** `pnpm run ci:local`

### Gotchas

- **pnpm node-linker must be `hoisted`:** The `core`, `runtime`, and `desktop` packages reference `tsc` without listing `typescript` as a devDependency — they rely on it being hoisted from `packages/ui`. If `node_modules/.modules.yaml` shows `nodeLinker: "isolated"`, delete all `node_modules` directories and reinstall: `rm -rf node_modules packages/*/node_modules apps/*/node_modules && pnpm install`. The update script sets `node-linker=hoisted` via `pnpm config`.
- **Ignored build scripts warning:** pnpm may warn about ignored build scripts for `esbuild`, `node-pty`, `sharp`, etc. This is expected and does not block dev server, lint, tests, or build for the UI package. The `onlyBuiltDependencies` allowlist in `package.json` intentionally restricts builds to `better-sqlite3`.
- **patch-package warning for next-ws:** In hoisted mode, `patch-package` in `packages/ui` may warn that `next-ws` is not found at `node_modules/next-ws` (it's at root). This is benign — the actual patching is handled by the `prepare` script (`next-ws patch`), which works correctly.
- **Use pnpm for typecheck:** Running `npm run typecheck` may fail because npm doesn't resolve `tsc` across workspaces the same way pnpm does. Always use `pnpm run typecheck`.
