# Local trainer contract (MLOps)

The app triggers training via `trigger_training` (backend `local`) by POSTing to a **local trainer** process. When `get_training_status(runId)` is called, the app polls the trainer to sync status and output model ref. This document defines the contract so a separate trainer service can be implemented.

## Endpoints

- **Base URL:** `LOCAL_TRAINER_URL` (default `http://localhost:8765`).

### POST /train

**Request body (JSON):**

- `jobId` (string): Improvement job id.
- `datasetRef` (string): Absolute path to the dataset file (JSONL from `generate_training_data`).
- `runId` (string): Training run id (UUID from the app).

**Response (JSON):**

- `run_id` or `id` (optional): Same as `runId` or external id. App uses `runId` for status polling.

**Behavior:** The trainer should start a training job (e.g. SFT/LoRA), write the output model to a known location or register with Ollama, and expose status via `GET /status/:runId`.

### GET /status/:runId

**Response (JSON):**

- `status` (string): `pending` | `running` | `completed` | `failed`.
- `output_model_ref` or `outputModelRef` (optional): Path or Ollama model name when `status === "completed"`.

When the app calls `get_training_status(runId)`, it fetches this endpoint and updates the `training_runs` row (status, output_model_ref, finished_at). The improvement agent can then call `register_trained_model(outputModelRef)` and `update_improvement_job(currentModelRef | instanceRefs)`.

## Dataset format

- **from_feedback:** One JSON object per line: `targetType`, `targetId`, `executionId`, `input`, `output`, `label`, `notes`, `createdAt`.
- **from_runs:** One JSON object per line: `runId`, `targetType`, `targetId`, `trail`, `output` (run trajectory for SFT/distillation).

## Versioning

Each training run has an immutable `id`. The run id serves as the version ref for "this agent's model at time T." Optional `experimentLabel` can be passed in `trigger_training` and is stored in `training_runs.config` for filtering.
