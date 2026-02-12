# Test Coverage Improvement Plan

Align test coverage with the criteria in [`.cursor/rules.md`](../rules.md) (Testing Strategy & Coverage Expectations).

---

## Current State (as of plan creation)

- **Overall:** ~12% statements, ~35% branches, ~32% functions (V8 coverage, `app/**/*.ts` only).
- **38 tests** across 7 files: agents, backup, RAG (encoding-config, document-store, collections), llm-providers, rate-limit-queue, runs-logs, lib/naming.
- **Fully or highly covered:** `naming.ts`, `response.ts`, agents list/create/execute, backup export/restore, RAG encoding/document-store/collections, llm providers list/create, rate-limit queue, runs + runs/[id] + logs + trace.
- **Zero or low coverage:** Most of `api/_lib/*`, chat route (~1509 lines), workflows, skills, tools, tasks, feedback, files, functions, import/export, ollama, sandbox, stats, system-stats, and many other route handlers.

---

## Rules.md Criteria (Summary)

| Area | Expectation |
|------|-------------|
| **Critical business logic** | Unit tests, ~90–100% coverage |
| **Non-critical / glue** | Reasonable coverage, behavior over line count |
| **Infrastructure / wiring** | Optional if implicitly tested; gaps must be justified |
| **Focus** | Branches, edge cases, failure modes; avoid implementation-detail and brittle tests |
| **Definition of done** | Core logic unit-tested; edge cases and failure modes covered; integration tests at boundaries; gaps intentional and explained |

---

## 1. Classify Code for Coverage

### 1.1 Critical business logic (target ~90–100% unit coverage)

- **`api/_lib/rag.ts`** – `getDeploymentCollectionId`, `cosineSimilarity`, `retrieveChunks` (with DB/embedding mocks).
- **`api/_lib/vector-store-query.ts`** – `queryQdrant`, `queryPgvector` (mock `fetch`); `getApiKey` and config edge cases.
- **`api/_lib/embeddings.ts`** – Embedding provider branching and error paths (mock external calls).
- **`api/_lib/run-workflow.ts`** – Core workflow execution and cancellation logic; extract pure/decidable parts for unit tests where possible.
- **`api/_lib/naming.ts`** – Already 100%; keep and add edge-case tests if any (e.g. format boundaries).
- **`api/_lib/response.ts`** – Already 100%; keep.
- **Chat route helpers (extract to _lib or test in isolation):**
  - `llmContextPrefix`, `normalizeChatError` (pure, easy unit tests).
  - `rephraseAndClassify` parsing (e.g. `<rephrased>`, `<wants_retry>`) with mocked LLM response.
  - Title generation fallback logic (truncation, empty response).
- **Workflows:** List/create/update/delete + **execute** (execute is critical; mock runtime/DB as needed).
- **Skills / tools / tasks:** CRUD plus any non-trivial validation or transformation (unit test the logic).

### 1.2 Non-critical but valuable (reasonable coverage)

- **`api/_lib/db.ts`** – Complex but largely schema/wiring; cover key helpers (e.g. row mappers) and error branches that are testable without full DB.
- **`api/_lib/store.ts`** – Small; add tests for success and failure paths if used by critical flows.
- **`api/_lib/system-stats.ts`** – Aggregation logic; unit test with stub data.
- **Backup reset route** – Currently 0%; add test for reset behavior (and 400 when body invalid if applicable).
- **Agents [id] refine route** – Refine endpoint; add at least one success path test (mock LLM).
- **Agents [id] skills route** – GET/PUT behavior; align with skills API contract.
- **RAG:** connectors, ingest, retrieve, upload, vector-store routes – Add route-level tests (similar to existing RAG tests) for status codes and response shape; mock heavy I/O.

### 1.3 Infrastructure / optional (document gaps)

- **`api/_lib/s3.ts`**, **`api/_lib/remote-test.ts`** – External I/O; document as “integration-only or manual; not unit-tested” unless you add integration tests.
- **Ollama routes** – External service; either integration tests against real/mock Ollama or document as out-of-scope for unit coverage.
- **Sandbox / run-code / sandbox-proxy** – Document as integration/boundary; add integration tests if boundaries are critical.
- **Chat route (bulk of 1509 lines)** – LLM and runtime calls; strategy: extract pure helpers → unit test; route handler → integration tests with mocked runtime/LLM or document which branches are covered by E2E/manual.

---

## 2. Implementation Plan

### Phase 1: Critical _lib unit tests (highest impact)

1. **`api/_lib/rag.ts`**
   - Unit test `cosineSimilarity` (equal length, zero vector, unequal length).
   - Unit test `getDeploymentCollectionId` and `retrieveChunks` with mocked `db` and `embed` (and optionally `queryQdrant`/`queryPgvector`).
2. **`api/_lib/vector-store-query.ts`**
   - Mock `fetch`; test `queryQdrant` and `queryPgvector` happy path and error response (e.g. 500, invalid JSON).
   - Test `getApiKey` (missing ref, undefined process).
3. **`api/_lib/embeddings.ts`**
   - Mock external embedding calls; test provider branching and error handling (e.g. empty response, network error).
4. **Chat helpers**
   - Extract or import `llmContextPrefix` and `normalizeChatError`; add tests for network/ECONNREFUSED, “Cannot convert undefined…”, OpenAI 404 appends docs link, no context.
   - Test rephrase parsing: `<rephrased>` present/absent, `wants_retry` yes/no, empty LLM response, trimmed input.
5. **`api/_lib/run-workflow.ts`**
   - Identify pure functions or small units (e.g. cancellation message handling, state transitions); add unit tests with mocks for DB and runtime.

**Deliverable:** New or extended `__tests__/api/_lib/` (e.g. `rag.test.ts`, `vector-store-query.test.ts`, `embeddings.test.ts`, `chat-helpers.test.ts`, `run-workflow.test.ts`). Aim for ~90%+ on these modules.

### Phase 2: Critical route coverage

1. **Workflows**
   - Add `__tests__/api/workflows.test.ts`: GET list, POST create, GET/PUT/DELETE by id, POST execute (mock runtime/DB so execute returns controlled result).
2. **Skills**
   - Add `__tests__/api/skills.test.ts`: list, create, get, update, delete (same pattern as agents/RAG).
3. **Tools**
   - Add `__tests__/api/tools.test.ts`: list, create, get, update, delete.
4. **Chat route**
   - Add `__tests__/api/chat.test.ts`: at least GET/POST conversation list and message append with mocked DB; optionally POST that triggers rephrase/title with mocked LLM (if feasible without full runtime).

**Deliverable:** Coverage for workflows, skills, tools; documented or partial coverage for chat route.

### Phase 3: Branches and failure modes (existing and new)

1. **Agents**
   - Add tests for invalid POST body (400), duplicate name or validation edge cases if any.
2. **Backup**
   - Add test for backup/reset route (currently 0%).
3. **RAG**
   - Add tests for 404 on missing collection/store, invalid payload (400), and branch coverage for encoding-config/document-store/collections (e.g. empty list branches).
4. **Runs**
   - Add tests for run not found (404), invalid log payload (400), and any branch in runs/[id] (e.g. status transitions).
5. **LLM providers**
   - Add tests for invalid POST (400), GET provider by id (200/404).

**Deliverable:** Higher branch % on already-touched routes; explicit tests for 4xx and not-found paths.

### Phase 4: Integration tests (boundaries)

1. **DB boundary**
   - Keep existing pattern (agents, backup, RAG, runs-logs) using real SQLite in test; ensure one integration test per major boundary (e.g. backup restore, run execute + logs).
2. **Optional**
   - Label integration tests (e.g. `describe("integration: …")` or file naming) so they can be run separately if needed.
   - Add integration test for workflow execute → run creation if not already covered by runs-logs.

**Deliverable:** Clear separation of unit vs integration; boundaries documented in rules or README.

### Phase 5: Document and justify gaps

1. **Coverage gap doc**
   - Add a short section (e.g. in `packages/ui/__tests__/README.md` or in `rules.md`) listing:
     - **Intentional gaps:** e.g. `s3.ts`, `remote-test.ts`, Ollama routes, sandbox-proxy; reason: external I/O or integration-only.
     - **Technical risk:** e.g. “Chat route LLM paths covered by integration/E2E only.”
2. **CI**
   - Keep “no enforced threshold” as per rules; use coverage report as risk signal and run `npm run test:coverage --workspace packages/ui` before push.

---

## 3. Suggested file layout

```
packages/ui/
  __tests__/
    api/
      _lib/
        rag.test.ts
        vector-store-query.test.ts
        embeddings.test.ts
        chat-helpers.test.ts   # if extracted from chat/route
        run-workflow.test.ts   # for testable units
      agents.test.ts           (existing)
      backup.test.ts           (existing)
      rag.test.ts              (existing)
      runs-logs.test.ts        (existing)
      llm-providers.test.ts    (existing)
      rate-limit-queue.test.ts (existing)
      workflows.test.ts        (new)
      skills.test.ts           (new)
      tools.test.ts            (new)
      chat.test.ts             (new, minimal)
    lib/
      naming.test.ts          (existing)
  app/...
```

---

## 4. Success Criteria (from rules.md)

- [ ] Critical business logic has unit tests and ~90–100% coverage (rag, vector-store-query, embeddings, chat helpers, run-workflow testable parts).
- [ ] Edge cases and failure modes covered (4xx, 404, invalid input) for critical and high-traffic routes.
- [ ] Integration tests exist for DB and key boundaries (backup, runs, optionally workflow execute).
- [ ] Coverage gaps are listed and justified (external I/O, integration-only).
- [ ] Before push: `npm run test:coverage --workspace packages/ui` and review HTML report; `npm test` and builds pass.

---

## 5. Order of work (recommended)

1. Phase 1 – _lib unit tests (rag, vector-store-query, embeddings, chat helpers).
2. Phase 3 (branches) – Add failure/edge tests to existing agents, backup, RAG, runs, llm-providers.
3. Phase 2 – Workflows, skills, tools route tests.
4. Phase 5 – Document gaps.
5. Phase 4 – Integration test labelling and any new boundary tests.

This order maximizes impact on “critical business logic” first while improving branch coverage on already-tested routes, then expands to new routes and documentation.
