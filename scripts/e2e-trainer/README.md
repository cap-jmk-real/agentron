# E2E stub trainer

Minimal HTTP server that implements the [local trainer contract](../../docs/local-trainer-contract.md) for the specialist-models e2e. It completes after a short delay and returns a synthetic `output_model_ref` so the full pipeline can be tested (trigger_training → get_training_status → register_trained_model → list_specialist_models).

## Run

```bash
node scripts/e2e-trainer/index.cjs
```

Listens on `http://127.0.0.1:8765` (or `E2E_TRAINER_PORT`). Set `LOCAL_TRAINER_URL` when running the app if you use a different port (e.g. `LOCAL_TRAINER_URL=http://localhost:8765`).

## E2E

The fourth test in `packages/ui/__tests__/e2e/specialist-models-pipeline.e2e.ts` ("real short finetuning run") checks `LOCAL_TRAINER_URL/health`. If the trainer is not reachable, the test is skipped. To run that test:

1. From repo root, start the trainer: `node scripts/e2e-trainer/index.cjs`
2. In another terminal, from repo root: `npm run test:e2e-llm --workspace packages/ui -- __tests__/e2e/specialist-models-pipeline.e2e.ts`  
   Or from `packages/ui`: `npx vitest run --config vitest.e2e.config.ts __tests__/e2e/specialist-models-pipeline.e2e.ts`
