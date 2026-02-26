---
name: SearXNG self-hosted web search
overview: Add SearXNG as a self-hosted web search provider with a docs tutorial and a UI link to that tutorial (no API for starting SearXNG).
todos:
  - id: runtime-search
    content: Add searxng provider and searchSearXNG() in packages/runtime/src/tools/search.ts
    status: pending
  - id: app-settings
    content: Add searxng and searxngBaseUrl in app-settings, API route, normalizers
    status: pending
  - id: wire-handlers
    content: Pass searxngBaseUrl from app settings into execute-tool and run-workflow-tool-execution
    status: pending
  - id: settings-ui
    content: Add SearXNG to provider dropdown, base URL input, and link to docs tutorial in packages/ui/app/settings/page.tsx
    status: pending
  - id: docs-tutorial
    content: Add docs/searxng-self-hosted-web-search.md with step-by-step manual setup
    status: pending
  - id: tests
    content: Unit tests for search, app-settings, tool execution, settings API; optional e2e
    status: pending
isProject: false
---

# SearXNG self-hosted web search

## Does SearXNG have an API?

Yes. SearXNG exposes a **built-in HTTP search API** (no separate product to configure):

- **Endpoints:** `GET /search` or `POST /search` (also `GET /` and `POST /`).
- **JSON:** Add `format=json` and the query: `?q=...&format=json`.
- **Parameters:** `q` (required), optional `categories`, `engines`, `language`, `pageno`, `time_range`, `safesearch`.
- **No API key** is required; only **enable JSON** in the instance config (`settings.yml` → `search.formats: [json]`). If JSON is not enabled, the server returns **403 Forbidden** for `format=json`.

---

## 1. Run SearXNG with JSON API enabled (manual)

Follow [SearXNG Docker installation](https://docs.searxng.org/admin/installation-docker.html#installation-container): create config dir, add `settings.yml` with:

```yaml
search:
  formats:
    - json
```

Then run the container (e.g. port 8888), restart to pick up config, and verify:

```bash
curl 'http://localhost:8888/search?q=test&format=json'
```

Response has a top-level `results` array; each result has `url`, `title`, `content` (we map `content` → snippet).

---

## 2. Code changes (Agentron)

### 2.1 Runtime: new provider and `searchSearXNG`

- **File:** [packages/runtime/src/tools/search.ts](packages/runtime/src/tools/search.ts)
- Extend `SearchWebOptions.provider` to `"duckduckgo" | "brave" | "google" | "searxng"`.
- Add optional `searxngBaseUrl?: string` (from options or env `SEARXNG_BASE_URL`).
- Implement `searchSearXNG(query, maxResults, baseUrl)`: GET `${baseUrl}/search?q=...&format=json`, map `results[]` (`url`, `title`, `content`) to `SearchResult`, slice to `maxResults`. On error return `{ results: [], error }`.
- In `searchWeb()`, when `provider === "searxng"` and URL set → call `searchSearXNG`; else if provider is `searxng` and URL missing → return clear error.

### 2.2 App settings and API

- [packages/ui/app/api/_lib/app-settings.ts](packages/ui/app/api/_lib/app-settings.ts): Add `"searxng"` to `WebSearchProvider`, `searxngBaseUrl?: string` to `AppSettings`; normalizers and `updateAppSettings` for both.
- [packages/ui/app/api/settings/app/route.ts](packages/ui/app/api/settings/app/route.ts): PATCH accepts `webSearchProvider === "searxng"` and `searxngBaseUrl`.

### 2.3 Wiring and Settings UI

- [execute-tool-handlers-web.ts](packages/ui/app/api/chat/_lib/execute-tool-handlers-web.ts), [run-workflow-tool-execution.ts](packages/ui/app/api/_lib/run-workflow-tool-execution.ts): Pass `searxngBaseUrl: appSettings.searxngBaseUrl` into `searchWeb`.
- [packages/ui/app/settings/page.tsx](packages/ui/app/settings/page.tsx): Add "SearXNG (self-hosted)" to provider dropdown; when selected show "SearXNG base URL" input and a **link to the docs tutorial** (e.g. "How to set up SearXNG" → docs page or `/docs/...` / repo `docs/searxng-self-hosted-web-search.md`); include base URL in save body.

---

## 3. Docs tutorial

- **New file:** [docs/searxng-self-hosted-web-search.md](docs/searxng-self-hosted-web-search.md)
- **Contents:** Step-by-step manual setup only (no app API for starting SearXNG):
  - **Prerequisites:** Docker or Podman.
  - **Setup:**
    1. Create directories: `mkdir -p ./searxng/config ./searxng/data` (or equivalent).
    2. Create `./searxng/config/settings.yml` with at least:

```yaml
       search:
         formats:
           - json
       

```

```
3. Run the container (replace `docker` with `podman` if you use Podman):
   
```

```bash
       docker run -d --name searxng -p 8888:8080 \
         -v "./searxng/config:/etc/searxng" \
         -v "./searxng/data:/var/cache/searxng" \
         docker.io/searxng/searxng:latest
       

```

```
4. Verify: `curl 'http://localhost:8888/search?q=test&format=json'`.
5. In Studio: Settings → Web search → Provider: SearXNG (self-hosted), Base URL: `http://localhost:8888`, Save.
```

- **Troubleshooting:** 403 for `format=json` → enable `search.formats: [json]` in `settings.yml`. Connection refused → ensure container is running and port 8888 is correct.
- Optionally link this doc from the docs site (e.g. under Guides or Installation) if a suitable page exists.

---

## 4. Tests

- **Runtime search:** Unit tests for SearXNG in [packages/runtime](packages/runtime): mock fetch, assert mapped results and error handling; assert missing URL when provider is searxng returns error.
- **App settings:** [app-settings.test.ts](packages/ui/__tests__/api/_lib/app-settings.test.ts): `webSearchProvider: "searxng"`, `searxngBaseUrl` get/set/empty.
- **Tool execution and execute-tool:** Assert `searchWeb` called with `searxngBaseUrl` when provider is searxng (mocked).
- **Settings API:** [settings-app.test.ts](packages/ui/__tests__/api/settings-app.test.ts): GET/PATCH with searxng and searxngBaseUrl.
- **E2E:** Optional; requires a running SearXNG instance; can be deferred.

---

## 5. Summary


| Item              | Action                                                                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SearXNG API       | Use `/search?q=...&format=json`; enable `search.formats: [json]` in `settings.yml`.                                                                                        |
| Runtime           | Add `searxng` provider and `searchSearXNG()` in [search.ts](packages/runtime/src/tools/search.ts).                                                                         |
| App settings      | Add `searxng` and `searxngBaseUrl`; wire in handlers and Settings UI.                                                                                                      |
| **Docs tutorial** | New [docs/searxng-self-hosted-web-search.md](docs/searxng-self-hosted-web-search.md): prerequisites, step-by-step manual setup, verify, configure Studio, troubleshooting. |
| **UI**            | Settings → Web search: SearXNG option, base URL input, and link to the docs tutorial (no API for starting/stopping SearXNG).                                               |
| Tests             | Unit tests for search, app-settings, tool execution, settings API; e2e optional.                                                                                           |


