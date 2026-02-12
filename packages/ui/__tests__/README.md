# UI package tests

## Running tests

- **Run all tests:** `npm run test` (from `packages/ui`) or `npm run test --workspace packages/ui` (from repo root).
- **Run with coverage:** `npm run test:coverage` (from `packages/ui`) or `npm run test:coverage --workspace packages/ui` (from repo root).
- **Coverage report:** After `test:coverage`, open `packages/ui/coverage/index.html` for a line-by-line report.

## Test layout

- **`api/_lib/*.test.ts`** — Unit tests for shared API helpers (rag, embeddings, vector-store-query, chat-helpers). Use mocks for DB and `fetch` where appropriate.
- **`api/*.test.ts`** — API route tests. These hit the real route handlers with a **real SQLite test database** (path set in `vitest.setup.ts`). They act as integration tests at the API boundary.
- **`lib/*.test.ts`** — Unit tests for app lib (e.g. naming).

## Coverage expectations (see `.cursor/rules.md`)

- **Critical business logic:** ~90–100% unit coverage (e.g. `_lib/rag`, `_lib/vector-store-query`, `_lib/embeddings`, `_lib/chat-helpers`).
- **Non-critical / glue:** Reasonable coverage; behavior over line count.
- **Infrastructure / external I/O:** Coverage optional; gaps must be justified.

## Intentional coverage gaps

These areas are **not** covered by unit tests by design; they are either integration-only, external, or low-risk.

| Area | Reason |
|------|--------|
| **`api/_lib/s3.ts`** | S3/external storage I/O; test via integration or manual. |
| **`api/_lib/remote-test.ts`** | Remote server connectivity; integration or manual. |
| **Ollama routes** (`api/ollama/*`) | External Ollama service; integration tests or manual. |
| **Sandbox / run-code / sandbox-proxy** | Container/process boundaries; integration or E2E. |
| **Chat route (bulk of `api/chat/route.ts`)** | LLM and runtime calls; pure helpers are in `_lib/chat-helpers` and unit-tested. Main handler covered by integration/E2E or manual. |
| **`api/_lib/run-workflow.ts`** | Heavy runtime/DB; testable units are limited; execution paths covered by workflow execute API test. |

No coverage threshold is enforced in CI; coverage is used as a **risk signal**. Run `npm run test:coverage --workspace packages/ui` before pushing and review the report.
