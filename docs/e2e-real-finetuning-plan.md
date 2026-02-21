# Plan: Short real fine-tuning run in specialist-models e2e

## Goal

Add one e2e test that runs a **real** (but minimal) fine-tuning job so the pipeline is validated end-to-end: trigger_training → trainer runs → get_training_status returns `completed` + `output_model_ref` → register_trained_model → list_specialist_models. Keep total added time low (target: under ~60s for the training step when trainer is available).

---

## Browser navigation improvement via fine-tuning (your idea)

**Idea:** Generate good and bad examples through real browser use, then fine-tune the LLM so it learns to pick the correct button/element (good behavior) and avoid wrong clicks (bad behavior).

### How it fits the existing pipeline

- **Feedback table** already stores `input`, `output`, `label` per row ([schema](packages/core/src/db/schema.ts)). For browser decisions: **input** = page context (snapshot + task), **output** = action taken (e.g. `{ action: "click", selectorOrRef: "..." }`), **label** = good/bad (or thumbs up/down).
- **generate_training_data** with strategy **from_feedback** exports these rows as JSONL for SFT/preference. So the same pipeline (generate_training_data → trigger_training → register_trained_model) can train a **browser specialist** that gets better at “given this page and task, choose this action.”
- **from_runs** can export full trajectories (including browser tool calls in the trail). Good for sequence-level learning; for “correct button” you can still label at run or step level and derive (context, action, label) per decision point.

### Collecting good vs bad examples

| Source | Good examples | Bad examples |
|--------|----------------|---------------|
| **User demonstration** | Record mode: user performs the task in the browser; capture (page snapshot → user click/fill). Each step = one “good” (context, correct action). Aligns with [BROWSER_AUTOMATION_DESIGN.md](BROWSER_AUTOMATION_DESIGN.md) “Learning from demonstration.” | — |
| **Agent runs** | Run completes task successfully → user marks run (or step) “good”; we store (snapshot, task, action taken, label=good). | Agent clicks wrong element or fails → user marks “bad” or we detect failure; store (snapshot, task, action taken, label=bad). Optionally: user corrects by clicking the right element → we store (same snapshot, correct action, label=good). |

**Implementation notes:**

- **Record mode (good only):** When the user has “record” on, each browser action (navigate, click, fill) is logged with the **page content/snapshot** at decision time and the **action** the user chose. Each of these becomes a feedback row: `input = { pageSnapshot, task }`, `output = { action, selectorOrRef }`, `label = "good"`, `targetId = agentId`.
- **Run-level feedback (good/bad):** User thumbs up/down on a run. We need to **associate feedback with the run’s browser decision points**. Today feedback can store `executionId`; the run’s `output.trail` has steps. If we persist tool-call detail (e.g. getContent result + tool call args) in the trail, we can: (1) when user marks run “bad,” create one feedback row per browser decision in that run with label=bad (input=context at that step, output=action taken); (2) optionally allow “correct action” in notes (e.g. correct selector) to add a “good” example from the same context.
- **Step-level feedback (optional):** UI could let the user mark a specific step as wrong and optionally provide the correct action (e.g. “should have clicked Submit, not the cookie banner”). Then one feedback row = (context at that step, wrong action, label=bad) and optionally (context, correct action, label=good).

### Training data format for “picking the correct button”

- **Per-decision rows** (from_feedback): Each row = one decision. `input` (JSON): `{ pageSnapshot: string, task?: string }` (and optionally previous actions). `output` (JSON): `{ action: "click"|"fill"|"navigate", selectorOrRef?: string, value?: string }`. `label`: `"good"` or `"bad"`. The trainer (SFT or preference) learns: given page + task → output the chosen action; preference can rank good over bad for the same context.
- **Trajectory** (from_runs): Full run with browser steps in the trail; label entire run or tag steps. Useful for sequence-level or multi-step consistency; can be converted to per-decision examples by slicing the trail at each browser tool call.

### Where this lives in the app

- **Scope:** An **agent** that has the browser tool (e.g. `std-browser-automation`) and optionally an improvement job scoped to that agent. `generate_training_data(scopeType: "agent", scopeId: agentId, strategy: "from_feedback")` collects all feedback for that agent (including browser decision rows). `trigger_training` uses the same local trainer; the resulting model can be registered and attached as a **specialist for that agent** (or for the browser tool) so browser decisions use the fine-tuned model.
- **E2e:** The **short real finetuning** e2e can stay generic (any from_feedback data). A **separate** e2e or script can: (1) create a browser agent, (2) simulate or record a few good/bad examples (e.g. 2 good, 1 bad), (3) POST feedback, (4) generate_training_data, (5) trigger_training, (6) poll get_training_status, (7) register_trained_model and optionally run one browser flow asserting the model prefers the right element (or stub the model for speed). That keeps the “short real finetuning” test fast and generic while still validating the browser-improvement path.

### Research note

- **BrowserAgent** (and similar work) uses SFT + rejection fine-tuning (RFT) on human-inspired browser actions and improves over base models with less data. So “good/bad examples from browser use + fine-tune” is a known pattern; our pipeline (from_feedback → trigger_training) is the right place to plug it in.
- **Natural language locators** (e.g. talk2dom): converting “the Submit button” to a selector is exactly the kind of decision we can improve with (page, task) → (action) training.

---

## Approach (short real finetuning e2e)

1. **Minimal local trainer** that implements the [local trainer contract](local-trainer-contract.md):
   - `POST /train`: accept `jobId`, `datasetRef`, `runId`; start a **single-step** (or single-batch) SFT run on a tiny model; write output to a deterministic path (e.g. `.data/models/e2e-<runId>` or an Ollama model name).
   - `GET /status/:runId`: return `pending` → `running` → `completed` with `output_model_ref` when done.

2. **Keep the run short** so e2e stays fast:
   - Option A (recommended): **1 batch, 1 step** with a very small model (e.g. 1–10M params, or LoRA on a small base). Use a single example from the JSONL. Target: 10–30s on CPU, or &lt;10s on GPU.
   - Option B: **Stub that simulates completion** after a short delay (e.g. 2s) and writes a minimal artifact (e.g. a tiny checkpoint or a placeholder file) so there is a real `output_model_ref` path. Less “real” but fastest and no Python/GPU dependency.
   - Decision: Prefer **Option A** if a tiny-model single-step run can be done in Node or a small Python script under 30s; otherwise **Option B** for CI speed with a note that “real” fine-tune can be run manually or in a separate nightly job.

3. **Where the trainer lives**
   - **Option A**: New script or small server, e.g. `scripts/e2e-trainer/` (Node + optional native or child_process to Python). Reads `datasetRef` JSONL, runs one step, writes to `getDataDir()/models/e2e-<runId>` (or similar), responds to GET /status with `completed` and that path.
   - **Option B**: In-repo minimal HTTP server (Node) that on /train spawns a one-off process (e.g. `node scripts/run-one-step-sft.js datasetRef runId`) or calls a tiny Python script; polls until the process exits, then marks run completed with a fixed output path. No real backward pass required for “minimal” variant—just one forward + save a tiny state so the path exists.

4. **E2e test changes**
   - Add a **fourth test**: “real short finetuning run: trigger → poll until completed → register → list”.
   - **Before test**: Try `GET LOCAL_TRAINER_URL/health` (or POST /train with a no-op and check 200). If unreachable, **skip** the test with `it.skipIf(!trainerAvailable)` or `it.skip("trainer not available")` so the rest of the suite stays fast and does not depend on the trainer.
   - **In test**: Create agent, run workflow, POST feedback, generate_training_data, create_improvement_job, trigger_training(backend: "local"). Then **poll** get_training_status every 2–3s with a **timeout** (e.g. 60s for Option B stub, 90s for Option A real step). If status becomes `completed`, assert `outputModelRef` is set, then register_trained_model(outputModelRef), update_improvement_job, list_specialist_models and assert the new model appears. If timeout or `failed`, fail the test (or skip with a message if we decide to allow skip on timeout).
   - **CI**: Run the specialist-models e2e suite as today. The new test is skipped when `LOCAL_TRAINER_URL` is not set or trainer not reachable; when the trainer is run (e.g. in CI with a pre-started stub or real micro-trainer), the test runs and validates the full path.

5. **Implementation order**
   - Implement the **minimal trainer** (Option B stub first for speed: 2s delay, write placeholder to a path, return completed + path).
   - Add the **e2e test** that skips when trainer is down and polls until completed when up.
   - Optionally replace stub with **Option A** (one real step) in a follow-up if we want a true short fine-tune in e2e.

6. **Browser navigation improvement (implementation order)**
   - Add **record mode** (or reuse CDP recording from BROWSER_AUTOMATION_DESIGN): on each user browser action, persist (pageSnapshot, task, action) and create a feedback row with label=good, targetId=agent.
   - Ensure **trail** (or execution log) includes browser tool-call context (getContent result + tool args) so run-level feedback can be turned into per-decision (context, action, label) when user marks a run good/bad.
   - **UI**: Allow marking a run (or step) as bad and optionally supplying the correct action; backend creates from_feedback rows in the format above.
   - Use **generate_training_data(from_feedback)** for the browser agent; **trigger_training** + **register_trained_model** as today; optionally bind the new instance to the agent or to the browser tool.
   - **E2e**: Optional dedicated e2e that creates 2–3 good/bad examples, runs the same short finetuning pipeline, then asserts the model is registered (or run one browser flow with a stub to keep CI fast).

---

## Summary

| Item | Detail |
|------|--------|
| Trainer | Minimal HTTP server (Node or Python) implementing POST /train, GET /status/:runId; either stub (2s + placeholder artifact) or 1-step real SFT. |
| Speed | Stub: &lt;5s; real 1-step: target 10–30s. E2e poll timeout 60–90s. |
| E2e | One new test: trigger → poll get_training_status until completed (or timeout) → register_trained_model → update_improvement_job → list_specialist_models. Skip when trainer unreachable. |
| Location | e.g. `scripts/e2e-trainer/` or `packages/ui/scripts/`; started manually or by CI before e2e. |
| Browser improvement | Good examples: record mode (user actions) or successful runs marked good. Bad examples: failed/wrong runs marked bad; optional step-level correction. Same pipeline: from_feedback → generate_training_data → trigger_training → register; optional e2e with browser-flavored examples. |

No change to the existing three specialist-models e2e tests; they remain fast and do not require the trainer.
