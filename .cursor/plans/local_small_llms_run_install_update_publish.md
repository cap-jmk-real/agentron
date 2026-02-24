# Local small LLMs: run, install, update, publish (sub-1B to 8B)

## Scope

- **Model size**: Below 1B parameters up to **8B** (sub-1B explicitly listed; 1B–8B as “small tier”).
- **Use case**: Autonomous agents that improve Agentron and themselves via [agent_for_recursive_slm_improvement.md](agent_for_recursive_slm_improvement.md), using small LLMs locally; users and agents need to run, install, update, and optionally publish these models from Agentron.

---

## 1. Sub-1B and small-tier list: auto-update (no manual maintenance)

The list of sub-1B (and optionally 1B–8B) models **must not be maintained by hand**. It should be **discovered and cached automatically** so you don’t own that part of the software.

### 1.1 How to auto-update

**Primary: Hugging Face API**

- Hugging Face’s models UI supports filtering by parameter count (e.g. `num_parameters=min:0,max:1B`). Use the same idea programmatically:
  - **Option A** – If the public Hub API supports it: call `GET https://huggingface.co/api/models` (or the endpoint that powers the UI) with parameters for `text-generation` (or `text-generation-inference`), `num_parameters` in the sub-1B range, sort by downloads, limit 50–100. Then do the same for 1B–8B. Confirm exact query params from [Hub API](https://huggingface.co/docs/hub/api) or by inspecting the UI’s network tab.
  - **Option B** – If there is no `num_parameters` in the API: run **several search queries** (e.g. `"0.5B"`, `"360M"`, `"135M"`, `"SmolLM"`, `"Qwen 0.5B"`, `"sub-1B"`, `"small language model"`) using the existing [packages/ui/app/api/llm/models/search/route.ts](packages/ui/app/api/llm/models/search/route.ts) (or a dedicated discovery route). Merge and dedupe by model id. Optionally fetch `config.json` for each model and filter by `num_parameters` / `num_hidden_layers` to keep only sub-1B / 1B–8B. This avoids depending on an undocumented filter.
- **Cache**: Write result to `.data/small-llm-cache.json` (or similar) with shape e.g. `{ lastUpdated: string (ISO), sub1B: CatalogModel[], small1Bto8B: CatalogModel[] }`. TTL e.g. 24 hours.
- **When to refresh**: On first use after expiry, or when user clicks **“Refresh”** on the Local Models “Recommended small LLMs” block. Optionally a background refresh on app load (non-blocking).

**Fallback: minimal seed list (only when cache empty or HF unreachable)**

- Keep a **tiny hardcoded list** (3–5 entries) in code only as fallback so the UI always shows something when offline or when the API returns nothing. Example: SmolLM2-360M, Qwen2.5-0.5B, SmolLM2-135M. No need to add every new model here; the live list comes from discovery. You only touch this if a canonical model is renamed or removed.

**Optional: scheduled job for a shared index**

- A weekly job (e.g. GitHub Action or cron) can run the same discovery logic and publish a JSON to a repo or a Hugging Face dataset (e.g. `agentron/small-llm-index`). The app then fetches that JSON (with TTL) instead of calling HF search on every refresh. The list is still auto-updated; maintenance is “run the job” not “edit model names.”

### 1.2 Implementation sketch

- **New API route** (e.g. `GET /api/llm/models/small-tier` or `GET /api/llm/models/discover-small`):
  - Reads cache; if missing or expired, runs discovery (HF API with param filter, or multiple search queries + optional config.json filter).
  - Returns `{ sub1B, small1Bto8B, lastUpdated }`. Optionally accepts `?refresh=1` to force refresh.
- **Catalog / types**: Reuse or extend [packages/runtime/src/llm/models/catalog.ts](packages/runtime/src/llm/models/catalog.ts) types (`CatalogModel`). Add a **small fallback list** (e.g. `SMALL_LLM_FALLBACK_SUB1B`) used only when cache is empty.
- **Docs**: In [docs/local-llm-research.md](docs/local-llm-research.md), add a short “Sub-1B and small tier” section that states the list is **auto-discovered from Hugging Face** and cached; no manual catalog to maintain. Optionally document the fallback list and the refresh behavior.

### 1.3 UI

- Local Models page (and any “recommended small LLMs” block): **Sub-1B** and **Small (1B–8B)** come from the discovery API (cached). Show a **“Refresh”** button to force update. No static list in code for the full catalog.

---

## 2. Run

**Current state:** Once a model is installed (Ollama pull, vLLM load, or HF Inference), the app already runs it via LLM config (local / custom_http / huggingface). No change needed for “run” itself.

**Tie-in:** Make it easy to pick a model from the **sub-1B / small-tier** discovery list when configuring an agent or chat (e.g. “Small / Sub-1B” preset or quick-pick that uses the same discovery API). Optional.

---

## 3. Install (from Agentron)

**Current state:** Ollama install (download or brew), Ollama pull (streamed), HF import (`ollama pull hf.co/...`), Local Models page with HF search + Import. [installers/](installers/README.md) is a placeholder.

**Planned changes:**

- **Sub-1B and small-tier in UI:** “Recommended small LLMs” block on Local Models uses the **discovery API** (auto-updated list). One-click “Pull” or “Import from HF” using the model id from the list.
- **installers/:** Add scripts (e.g. `install-ollama.ps1`, `install-ollama.sh`) and optional “install Ollama + default small model” (e.g. pull one sub-1B from discovery). API can open URLs or, with user consent, run installer scripts.
- **Agent use:** Tools that call existing APIs (`install_local_model`, etc.) so agents can install models without maintaining lists.

---

## 4. Update

- **Model update:** “Update” = re-pull same model. Add “Update” per model on Local Models (calls existing pull API). Optional agent tool.
- **Ollama binary update:** Entry point (e.g. “Update Ollama”) that opens download page or runs `brew upgrade ollama` on macOS.

---

## 5. Publish (optional, phase 2)

- **Publish to Hugging Face:** API + optional UI to push a model (or adapter) to HF; credentials from env or secure ref. Agent tool `publish_model`.
- **Export Modelfile:** Optional “Export Modelfile” for Ollama models for sharing.

---

## 6. Build order (start here)

| Area | Action |
|------|--------|
| **Sub-1B / small list** | **Auto-update only:** discovery from HF (API filter or search queries + config filter), cache in `.data`, TTL + “Refresh” in UI; minimal fallback list in code. No manual catalog maintenance. |
| **Run** | No engine change; optional preset from discovery list. |
| **Install** | Local Models: “Recommended small LLMs” from discovery API + one-click pull/import; installers/ scripts; optional default-model install. |
| **Update** | “Update” per model (re-pull) + “Update Ollama” entry point. |
| **Publish** | Phase 5: HF upload + optional Modelfile export; agent tool. |

**Start building with Phase 1** (discovery API + cache + fallback), then Phase 2 (UI).

### Phase 1: Discovery API + cache + fallback

| Step | What to do | Files |
|------|------------|--------|
| 1.1 | Add fallback list and shared types for small-tier models. | [packages/runtime/src/llm/models/catalog.ts](packages/runtime/src/llm/models/catalog.ts): add `SMALL_LLM_FALLBACK_SUB1B` (3–5 entries). Reuse or extend `CatalogModel`. |
| 1.2 | Create discovery logic: HF API or multiple search queries, merge/dedupe, filter by size. | New: `packages/ui/app/api/llm/models/_lib/discover-small.ts` with `discoverSmallModels()`. Use [search/route.ts](packages/ui/app/api/llm/models/search/route.ts) pattern. Return fallback when HF fails. |
| 1.3 | Add cache: read/write `.data/small-llm-cache.json`, TTL 24h. | Same module or `api/_lib/small-llm-cache.ts`. Use `process.cwd()` or `AGENTRON_DATA_DIR`. |
| 1.4 | New API route: GET small-tier list (from cache; refresh if expired or `?refresh=1`). | New: `packages/ui/app/api/llm/models/small-tier/route.ts`. Return `{ sub1B, small1Bto8B, lastUpdated }`. |
| 1.5 | Document behavior. | [docs/local-llm-research.md](docs/local-llm-research.md): add "Sub-1B and small tier" section. |

**Done when:** `GET /api/llm/models/small-tier` returns sub1B and small1Bto8B; fallback works when offline.

### Phase 2: Local Models UI – Recommended small LLMs block

| Step | What to do | Files |
|------|------------|--------|
| 2.1 | Fetch small-tier list on load; show "Sub-1B" and "Small (1B–8B)" sections. | [packages/ui/app/settings/local/page.tsx](packages/ui/app/settings/local/page.tsx): call `GET /api/llm/models/small-tier`, render two sections. |
| 2.2 | Add "Refresh" button: refetch with `?refresh=1`. | Same page: button calls `GET /api/llm/models/small-tier?refresh=1`, update state. |
| 2.3 | One-click "Pull" or "Import from HF" per model. | Reuse `doPullWithModel` / HF import; button per row sets model id. |

**Done when:** User sees lists, can Refresh and Pull/Import any row.

### Phase 3: Installers and optional default-model install

| Step | What to do | Files |
|------|------------|--------|
| 3.1 | Add Ollama install scripts. | [installers/](installers/): `install-ollama.ps1` (Windows), `install-ollama.sh` (Linux). Update [installers/README.md](installers/README.md). |
| 3.2 | Optional: "Install Ollama + default small model" flow. | API or UI: install URL/script, then poll status and pull one sub-1B from discovery. |

### Phase 4: Update model and Update Ollama

| Step | What to do | Files |
|------|------------|--------|
| 4.1 | "Update" per model on Local Models. | [packages/ui/app/settings/local/page.tsx](packages/ui/app/settings/local/page.tsx): "Update" button per model calls `POST /api/ollama/pull` with same name. |
| 4.2 | "Update Ollama" entry point. | Link/button opens download page or runs `brew upgrade ollama` on macOS (reuse [install/route.ts](packages/ui/app/api/ollama/install/route.ts)). |

### Phase 5: Publish (later)

| Step | What to do | Files |
|------|------------|--------|
| 5.1 | API to push model/adapter to HF (token from env or secure ref). | New: `POST /api/llm/models/publish`. |
| 5.2 | Optional: Export Modelfile for Ollama model. | New route or tool returning Modelfile text. |
| 5.3 | Agent tool `publish_model` that calls the API. | Runtime tools: add tool for improvement agent. |

Phases 1–2 are the minimum to ship (discovery API + Local Models UI). Phases 3–5 can follow in order. **Start with Phase 1, step 1.1.**

This keeps the sub-1B (and 1B–8B) list **explicit but auto-updated**, so you don’t maintain that part of the software.
