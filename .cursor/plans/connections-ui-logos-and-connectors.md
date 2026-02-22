# Connections UI/UX, logos, and essential connectors

## Overview

Improve the UI/UX for connections (RAG connectors on the Knowledge page and optional Settings integration polish) with provider logos and card-based layouts; define a prioritized set of **essential connectors** for growth; and ensure **every change is covered by tests** per project criteria (100% branch coverage for in-scope code, no coverage exclusions to hit targets).

---

## Part 1: Essential connectors (research-based)

The software will grow with relevant connections. Below is a prioritized list of connectors that are commonly essential for dev tools, RAG/knowledge bases, and automation platforms (sources: RAG doc sources, enterprise search, PKM tools, documentation platforms 2024–2025).

### Tier 1 — Cloud file storage (RAG document sync)

| Connector       | Role                | Rationale |
|----------------|---------------------|-----------|
| **Google Drive** | RAG document sync  | Already implemented. Dominant cloud file storage; docs, specs, PDFs. |
| **Dropbox**     | RAG document sync  | Already in schema/docs. Second major cloud storage; many teams use it for shared docs. |
| **OneDrive / SharePoint** | RAG document sync | Microsoft ecosystem; enterprise docs, Teams files. Often requested with Drive and Dropbox. |

### Tier 2 — Knowledge bases and collaborative docs

| Connector   | Role                          | Rationale |
|------------|--------------------------------|-----------|
| **Notion** | RAG sync (pages, databases)   | Central for many teams (specs, wikis, project docs); OAuth + API; Notion-to-RAG pipelines are common. |
| **Confluence** | RAG document sync           | Enterprise knowledge base; often paired with Jira; APIs and connectors widely used. |
| **GitBook** | RAG document sync             | Product/docs hosting; API and integrations (e.g. Inkeep); good for public or internal docs. |
| **BookStack** | RAG document sync            | Self-hosted wiki; REST API; used by Danswer, SiteSpeakAI, and others for RAG. |

### Tier 3 — Personal knowledge management (PKM)

| Connector   | Role                          | Rationale |
|------------|--------------------------------|-----------|
| **Obsidian** | RAG sync from vault            | Note-centric, local-first; vault = folder of Markdown. Integration: **local path** to vault (same as filesystem connector with .md focus) or (future) Obsidian Local REST API plugin. Very popular with devs and researchers. |
| **LogSeq**  | RAG sync from graph            | Outliner-first, Markdown + Git; can sync via shared folder or Git. Plugin API (logseq.App, logseq.Editor, etc.); similar “local folder” or Git-backed sync as Obsidian. |
| **Roam Research** | RAG sync (future)         | Cloud-based PKM; API/export options; lower priority than Obsidian/LogSeq for self-hosted workflows. |

### Tier 4 — Code, issues, and communication (complement RAG)

| Connector | Role | Rationale |
|-----------|------|-----------|
| **GitHub** | Settings integration (run errors → issues). Optional: RAG from repo docs / README / wiki. | Already integrated; repo content as RAG source is a natural extension. |
| **GitLab** | Same as GitHub (repos, issues; optional RAG from repo content). | Alternative to GitHub in many orgs. |
| **Jira** | Optional RAG from issues (descriptions, comments). | LangChain and others have Jira loaders; specs and tickets as context. |
| **Linear** | Optional RAG from issues (export CSV/Markdown). | Modern issue tracker; export and copy-as-Markdown support. |
| **Slack** | Notifications / triggers; optional RAG over channel history. | Dev communication; often integrated with GitHub/Jira/Notion. |
| **Discord** | Optional RAG over server/channel content. | Community and dev servers; some RAG platforms list it. |

### Tier 5 — Optional / niche

| Connector | Role | Rationale |
|-----------|------|-----------|
| **Readwise** | Highlights/annotations as RAG sources. | Syncs highlights from Kindle, Instapaper, etc.; different content shape but used in some knowledge pipelines. |
| **Coda** | RAG document sync. | Doc/spreadsheet hybrid; sometimes listed with Notion/Confluence. |

**Recommendation for this plan**

- **UI and metadata:** Add connector-type metadata (id, label, logo, description, `syncImplemented`) for:
  - **Tier 1:** Google Drive, Dropbox, OneDrive
  - **Tier 2:** Notion, Confluence, GitBook, BookStack
  - **Tier 3:** Obsidian, LogSeq (and optionally Roam as “Coming later”)
  - **Tier 4:** GitHub, GitLab (as RAG sources; Settings integration stays separate), Jira, Linear, Slack, Discord as optional later
  Types without sync yet show as “Coming soon” or are hidden until implemented; Obsidian/LogSeq can be implemented early via **local vault path** (reuse or specialise filesystem connector with provider branding).
- **Sync implementation priority:** (1) Google Drive (done); (2) Dropbox or OneDrive; (3) Notion (OAuth + API); (4) Obsidian / LogSeq (local folder or Git); (5) Confluence, GitBook, BookStack. Each new type gets full branch coverage in sync route tests.
- **Settings integrations (GitHub, Telegram)** remain separate; optional polish is adding a small logo to their settings pages. A future “Connections” hub could list both RAG connectors and these integrations with logos.

---

## Part 2: UI/UX and logos (unchanged intent)

- **Provider logo assets** under `packages/ui/public/connectors/`: Add logos for all connector types that appear in the UI. Start with: Google Drive, Dropbox, OneDrive, Notion, Confluence, GitBook, BookStack, Obsidian, LogSeq (and placeholders for Roam, Jira, Linear, Slack, Discord if shown). Use official brand guidelines (Google, Dropbox, Notion, Atlassian, etc.); no false endorsement. Obsidian and LogSeq have community/brand assets; use consistent size and fallback for unknown types.
- **Shared connector metadata** (e.g. `packages/ui/app/knowledge/_lib/connector-types.ts`): Map `type` → `label`, `logoPath`, `description`, `syncImplemented` (boolean). Include all Tier 1–3 types at minimum; Tier 4–5 as needed. Used by Knowledge Connectors tab and any future hub.
- **Knowledge → Connectors tab:** Provider cards for “Add connector” (click to expand form); connector list as cards with logo, name, collection, status, last sync; empty state with visual cue. Use existing `.card` and design tokens; new CSS classes in globals (e.g. `.connector-card`, `.connector-card-logo`).
- **Optional:** Small provider logo on GitHub and Telegram settings pages for consistency.

---

## Part 3: Testing (project criteria)

Per `.cursor/rules/coverage-and-test-failures.mdc`, `.cursor/rules/bug-fix-add-tests.mdc`, and `packages/ui/__tests__/README.md`:

- **Do not** lower the branch coverage threshold (100% for in-scope code).
- **Improve coverage by adding tests**, not by excluding code.
- **Test the contract:** inputs/outputs, error messages, observable behavior.
- **Branches and edge cases:** Every branch (conditionals, error paths) must be covered.

### 3.1 Connector API (existing + new behaviour)

- **Existing:** `packages/ui/__tests__/api/rag-connectors.test.ts` already covers: GET list, POST (invalid JSON, create), GET/PUT/DELETE by id (404, 200), PUT update. Keep these; ensure any new validation (e.g. allowed `type` or required fields) is covered.
- **If** you add validation in `POST /api/rag/connectors` (e.g. reject unknown `type` or require type-specific `config`), add tests: valid type accepted, invalid type returns 400 with clear error.

### 3.2 Connector sync route (branches)

- **File:** `packages/ui/app/api/rag/connectors/[id]/sync/route.ts`. Branches: connector not found (404); collection not found (404); `google_drive`: missing `serviceAccountKeyRef` or env (400), invalid JSON in env (400), then success path (mock Drive API); default branch “Sync not implemented for connector type” (501 or 400).
- **Tests** in `packages/ui/__tests__/api/rag-connectors-sync.test.ts`:
  - Already: 404 for non-existent connector.
  - Add: 404 when collection is missing (connector points to deleted collection).
  - Add: 400 for `google_drive` when `serviceAccountKeyRef` missing or env var unset (assert error message).
  - Add: 400 for `google_drive` when env var is set but not valid JSON (assert error message).
  - Add: 400/501 for unknown connector type (e.g. `type: "dropbox"` before implementation) with message containing “not implemented” or “Sync not implemented”.
  - Success path for `google_drive`: use **mocked** `googleapis` or mocked `fetch` so no real Drive API call; assert status 200 and that connector status/DB is updated as expected. (If the route is excluded from coverage today, still add these tests so that when/if sync is brought in-scope, branches are covered; otherwise remove exclusion and cover.)
- **When adding a new connector type (e.g. Dropbox):** Add tests for all new branches in the sync route (missing config, auth failure, success with mocks). No new code path without a test.

### 3.3 Connector-type metadata (new module)

- **File:** e.g. `packages/ui/app/knowledge/_lib/connector-types.ts` (or `connector-metadata.ts`) — pure data or small helpers: map `type` → label, logoPath, description, syncImplemented.
- **Tests:** Add `packages/ui/__tests__/lib/connector-types.test.ts` (or under `knowledge/` if you prefer): assert that every type used in the UI has a label and logoPath (or fallback); assert `syncImplemented` is true only for types that have sync implemented in the sync route. This keeps metadata and implementation in sync and documents expected behaviour.

### 3.4 UI components

- **Per vitest.config.ts:** `app/components/**` are excluded from coverage; no need to unit-test every React component. E2E or manual testing for the Connectors tab is acceptable. If you extract a small helper (e.g. “get connector display info”) into a non-component module, unit-test that.

### 3.5 Checklist before considering the change complete

- Run `npm run test:coverage` from repo root; fix any coverage regression; do not add new coverage exclusions for connector code.
- Run `npm run pre-push` (format, typecheck, lint, test, build).
- New connector type (e.g. Dropbox) = new sync branches → new tests for those branches; update connector-types and connector-types test.

---

## Part 4: Files to add or touch

| Area | Action |
|------|--------|
| `packages/ui/public/connectors/` | Add logos: Google Drive, Dropbox, OneDrive, Notion, Confluence, GitBook, BookStack, Obsidian, LogSeq (and placeholders for Roam, Jira, Linear, Slack, Discord if shown in UI). |
| `packages/ui/app/knowledge/_lib/connector-types.ts` | New: map type → label, logoPath, description, syncImplemented. |
| `packages/ui/app/knowledge/page.tsx` | Connectors tab: provider cards for Add, card list for connectors, use connector-types; new CSS classes. |
| `packages/ui/app/css/` | Classes for `.connector-card`, logo, meta, empty state. |
| `packages/ui/__tests__/api/rag-connectors-sync.test.ts` | Add tests for 404 (missing collection), 400 (google_drive config/env), 400/501 (unknown type), and success with mocked Drive. |
| `packages/ui/__tests__/lib/connector-types.test.ts` (or under knowledge) | New: test connector-types metadata consistency and syncImplemented vs sync route. |
| `packages/ui/app/api/rag/connectors/[id]/sync/route.ts` | No behaviour change required for “essential connectors” list; when adding Dropbox/other, add branches and tests. |
| `packages/ui/app/settings/github/page.tsx`, `telegram/page.tsx` | Optional: add small header logo. |

---

## Part 5: Out of scope (for later)

- Implementing sync for all listed connectors (only Google Drive is implemented; UI + metadata + testing pattern in place for the rest). When adding sync for any new type (Dropbox, Notion, Obsidian, LogSeq, Confluence, GitBook, BookStack, etc.), add full branch coverage in sync route tests.
- A dedicated “Connections” hub page aggregating RAG connectors + GitHub + Telegram.
- Changing RAG connector API or schema beyond current design.
- Obsidian Local REST API or LogSeq plugin integration (optional future; local path / filesystem sync is sufficient for first PKM support).

---

## Summary

1. **Essential connectors:** Tier 1 (Google Drive, Dropbox, OneDrive); Tier 2 (Notion, Confluence, GitBook, BookStack); Tier 3 (Obsidian, LogSeq, Roam); Tier 4 (GitHub, GitLab, Jira, Linear, Slack, Discord); Tier 5 (Readwise, Coda). UI and metadata prepared for Tiers 1–3 at minimum; sync only for Google Drive now, then Dropbox/OneDrive/Notion/Obsidian–LogSeq (local path) as prioritised.
2. **UI:** Logos and card-based Connectors tab; shared connector-types metadata for all tiers; optional Settings page logos.
3. **Testing:** Full branch coverage for connector API and sync route; new connector-types unit test; every new connector type gets tests when sync is implemented; no new coverage exclusions; `npm run pre-push` must pass.
