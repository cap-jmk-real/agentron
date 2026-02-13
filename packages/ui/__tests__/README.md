# UI package tests

## Running tests

- **Run all tests:** `npm run test` (from `packages/ui`) or `npm run test --workspace packages/ui` (from repo root).
- **Run with coverage:** `npm run test:coverage` (from `packages/ui`) or `npm run test:coverage --workspace packages/ui` (from repo root).
- **Coverage report:** After `test:coverage`, open `packages/ui/coverage/index.html` for a line-by-line report.

## Test layout

- **`api/_lib/*.test.ts`** — Unit tests for shared API helpers (rag, embeddings, vector-store-query, chat-helpers). Use mocks for DB and `fetch` where appropriate.
- **`api/*.test.ts`** — API route tests. These hit the real route handlers with a **real SQLite test database** (path set in `vitest.setup.ts`). They act as integration tests at the API boundary. Telegram settings and webhook tests mock `fetch` (getMe, sendMessage, and internal /api/chat, /api/llm/providers) so no real Telegram or LLM calls are made.
- **`lib/*.test.ts`** — Unit tests for app lib (e.g. naming).

## Coverage expectations (see `.cursor/rules.md`)

- **Critical business logic:** ~90–100% unit coverage (e.g. `_lib/rag`, `_lib/vector-store-query`, `_lib/embeddings`, `_lib/chat-helpers`).
- **Non-critical / glue:** Reasonable coverage; behavior over line count.
- **Infrastructure / external I/O:** Coverage optional; gaps must be justified.

## Intentional coverage gaps

These areas are **not** covered by unit tests by design; they are either integration-only, external, or low-risk. For a detailed rationale (why each is hard to unit-test), see [.cursor/plans/coverage-above-70-percent.md](../../.cursor/plans/coverage-above-70-percent.md) § “Why some code is not (easily) unit testable”.

| Area | Reason |
|------|--------|
| **`api/_lib/s3.ts`** | S3/external storage I/O; test via integration or manual. |
| **`api/_lib/remote-test.ts`** | Remote server connectivity (spawns `ssh`); integration or manual. |
| **Ollama routes** (`api/ollama/*`) | External Ollama service; integration tests or manual. |
| **OpenClaw** (`api/_lib/openclaw-client.ts`, `api/openclaw/*`) | External OpenClaw Gateway WebSocket; integration or manual. See docs/openclaw-integration.md. |
| **Sandbox / run-code / sandbox-proxy** | Container/process boundaries (Podman); integration or E2E. |
| **Chat route (bulk of `api/chat/route.ts`)** | LLM and runtime calls; pure helpers are in `_lib/chat-helpers` and unit-tested. Main handler covered by integration/E2E or manual. |
| **`api/_lib/run-workflow.ts`** | Heavy runtime/DB; testable units are limited; execution paths covered by workflow execute API test. |
| **`app/lib/system-stats-interval.ts`** | Browser-only (`window`, `localStorage`); Node test env doesn’t provide them; logic is simple. |

**Coverage target:** >70% statements/lines for in-scope code (see exclusions in `vitest.config.ts`). A 70% threshold is enforced so CI fails if coverage drops below target. **Before pushing:** run the check routine (`npm run check` from repo root) to run typecheck, lint, and tests with coverage; or run `npm run pre-push` for the full pre-push pipeline including builds and desktop dist.
