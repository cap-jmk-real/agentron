# Refactor: execute-tool handlers split

## Status: Complete

## Done

- **Shared types**: `ExecuteToolFn` and `ExecuteToolContext` live in [execute-tool-shared.ts](packages/ui/app/api/chat/_lib/execute-tool-shared.ts).
- **Handler modules** (all under `packages/ui/app/api/chat/_lib/`):
  - `execute-tool-handlers-sandbox.ts` – create_sandbox, execute_code, run_container_command, list_sandboxes
  - `execute-tool-handlers-workflows.ts` – delete_workflow, list_workflow_versions, rollback_workflow
  - `execute-tool-handlers-custom-functions.ts` – create_code_tool, list_custom_functions, get_custom_function, update_custom_function, create_custom_function
  - `execute-tool-handlers-runs.ts` – list_runs, cancel_run, respond_to_run, get_run, get_run_messages, get_run_for_improvement, get_feedback_for_scope, execute_workflow
  - `execute-tool-handlers-stores.ts` – create_store, put_store, get_store, query_store, list_stores, delete_store
  - `execute-tool-handlers-guardrails.ts` – create_guardrail, list_guardrails, get_guardrail, update_guardrail, delete_guardrail
  - `execute-tool-handlers-reminders.ts` – create_reminder, list_reminders, cancel_reminder
  - `execute-tool-handlers-files.ts` – list_files
  - `execute-tool-handlers-web.ts` – web_search, fetch_url
  - `execute-tool-handlers-shell.ts` – run_shell_command
  - `execute-tool-handlers-remote-servers.ts` – list_remote_servers, test_remote_connection, save_remote_server
  - `execute-tool-handlers-assistant.ts` – answer_question, explain_software, remember, get_assistant_setting, set_assistant_setting
  - **execute-tool-handlers-improvement.ts** – create_improvement_job, get_improvement_job, list_improvement_jobs, update_improvement_job, generate_training_data, evaluate_model, trigger_training, get_training_status, decide_optimization_target, get_technique_knowledge, record_technique_insight, propose_architecture, spawn_instance (uses executeToolRef), register_trained_model, list_specialist_models
  - **execute-tool-handlers-openclaw.ts** – send_to_openclaw, openclaw_history, openclaw_abort (includes normalizeOpenClawHistoryMessage; uses ctx.vaultKey for vault credentials)
- **Dispatcher**: [execute-tool-handlers-workflows-runs-reminders.ts](packages/ui/app/api/chat/_lib/execute-tool-handlers-workflows-runs-reminders.ts) is now a **thin dispatcher** (~95 lines):
  - Single `HANDLER_REGISTRY` array of `{ names, handler, passExecuteToolRef? }`; adding a new domain is one registry entry.
  - `executeToolHandlersWorkflowsRunsReminders` loops the registry, delegates to the first matching handler (passing `executeToolRef` only when `passExecuteToolRef` is true), and returns `undefined` when no handler matches.
  - No tool logic remains in this file; all tools are implemented in the 14 handler modules.
- **Build and tests**: `npm run build:ui` and full UI test suite (139 files, 2180 tests) pass. No regressions; existing execute-tool tests cover improvement and OpenClaw via the dispatcher.

## Left

Nothing. Optional future work: add unit tests that import the dispatcher directly and assert unknown tool returns undefined and a known tool is delegated (covered indirectly by existing execute-tool tests).
