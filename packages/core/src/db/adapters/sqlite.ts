import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { DatabaseAdapter } from "./types";

export type SqliteAdapter = DatabaseAdapter<ReturnType<typeof drizzle>>;

const SCHEMA_SQL = `
        create table if not exists agents (
          id text primary key,
          name text not null,
          description text,
          kind text not null,
          type text not null,
          protocol text not null,
          endpoint text,
          agent_key text,
          capabilities text not null,
          scopes text not null,
          llm_config text,
          definition text,
          created_at integer not null
        );
        create table if not exists workflows (
          id text primary key,
          name text not null,
          description text,
          nodes text not null,
          edges text not null,
          execution_mode text not null,
          schedule text,
          max_rounds integer,
          turn_instruction text,
          branches text,
          execution_order text,
          created_at integer not null
        );
        create table if not exists tools (
          id text primary key,
          name text not null,
          protocol text not null,
          config text not null,
          input_schema text,
          output_schema text
        );
        create table if not exists prompts (
          id text primary key,
          name text not null,
          description text,
          arguments text,
          template text not null
        );
        create table if not exists llm_configs (
          id text primary key,
          provider text not null,
          model text not null,
          api_key_ref text,
          endpoint text,
          extra text
        );
        create table if not exists executions (
          id text primary key,
          target_type text not null,
          target_id text not null,
          target_branch_id text,
          conversation_id text,
          status text not null,
          started_at integer not null,
          finished_at integer,
          output text
        );
        create table if not exists run_logs (
          id text primary key,
          execution_id text not null,
          level text not null,
          message text not null,
          payload text,
          created_at integer not null
        );
        create table if not exists workflow_messages (
          id text primary key,
          execution_id text not null,
          node_id text,
          agent_id text,
          role text not null,
          content text not null,
          message_type text,
          metadata text,
          created_at integer not null
        );
        create table if not exists execution_events (
          id text primary key,
          execution_id text not null,
          sequence integer not null,
          type text not null,
          payload text,
          processed_at integer,
          created_at integer not null
        );
        create table if not exists execution_run_state (
          execution_id text primary key,
          workflow_id text not null,
          target_branch_id text,
          current_node_id text,
          round integer not null,
          shared_context text not null,
          status text not null,
          waiting_at_node_id text,
          trail_snapshot text,
          updated_at integer not null
        );
        create table if not exists workflow_queue (
          id text primary key,
          type text not null,
          payload text not null,
          status text not null,
          run_id text,
          enqueued_at integer not null,
          started_at integer,
          finished_at integer,
          error text,
          created_at integer not null
        );
        create table if not exists conversation_locks (
          conversation_id text primary key,
          started_at integer not null,
          created_at integer not null
        );
        create table if not exists message_queue_log (
          id text primary key,
          conversation_id text not null,
          message_id text,
          type text not null,
          phase text,
          label text,
          payload text,
          created_at integer not null
        );
        create table if not exists skills (
          id text primary key,
          name text not null,
          description text,
          type text not null,
          content text,
          config text,
          created_at integer not null
        );
        create table if not exists agent_skills (
          agent_id text not null,
          skill_id text not null,
          sort_order integer not null,
          config text,
          created_at integer not null,
          primary key (agent_id, skill_id)
        );
        create table if not exists contexts (
          id text primary key,
          key text not null,
          value text not null,
          updated_at integer not null
        );
        create table if not exists conversations (
          id text primary key,
          title text,
          rating integer,
          note text,
          summary text,
          last_used_provider text,
          last_used_model text,
          created_at integer not null
        );
        create table if not exists assistant_memory (
          id text primary key,
          key text,
          content text not null,
          created_at integer not null
        );
        create table if not exists chat_messages (
          id text primary key,
          conversation_id text,
          role text not null,
          content text not null,
          tool_calls text,
          created_at integer not null
        );
        create table if not exists files (
          id text primary key,
          name text not null,
          mime_type text not null,
          size integer not null,
          path text not null,
          created_at integer not null
        );
        create table if not exists sandboxes (
          id text primary key,
          name text not null,
          image text not null,
          status text not null,
          container_id text,
          config text not null,
          created_at integer not null
        );
        create table if not exists custom_functions (
          id text primary key,
          name text not null,
          description text,
          language text not null,
          source text not null,
          sandbox_id text,
          created_at integer not null
        );
        create table if not exists token_usage (
          id text primary key,
          execution_id text,
          agent_id text,
          workflow_id text,
          provider text not null,
          model text not null,
          prompt_tokens integer not null,
          completion_tokens integer not null,
          estimated_cost text,
          created_at integer not null
        );
        create table if not exists model_pricing (
          id text primary key,
          model_pattern text not null,
          input_cost_per_m text not null,
          output_cost_per_m text not null,
          updated_at integer not null
        );
        create table if not exists feedback (
          id text primary key,
          target_type text not null,
          target_id text not null,
          execution_id text,
          input text not null,
          output text not null,
          label text not null,
          notes text,
          created_at integer not null
        );
        create table if not exists remote_servers (
          id text primary key,
          label text not null,
          host text not null,
          port integer not null,
          user text not null,
          auth_type text not null,
          key_path text,
          model_base_url text,
          created_at integer not null
        );
        create table if not exists sandbox_site_bindings (
          id text primary key,
          sandbox_id text not null,
          host text not null,
          container_port integer not null,
          host_port integer not null,
          created_at integer not null
        );
        create table if not exists tasks (
          id text primary key,
          workflow_id text not null,
          execution_id text,
          agent_id text not null,
          step_id text not null,
          step_name text not null,
          label text,
          status text not null,
          input text,
          output text,
          created_at integer not null,
          resolved_at integer,
          resolved_by text
        );
        create table if not exists rag_encoding_configs (
          id text primary key,
          name text not null,
          provider text not null,
          model_or_endpoint text not null,
          dimensions integer not null,
          created_at integer not null
        );
        create table if not exists rag_document_stores (
          id text primary key,
          name text not null,
          type text not null,
          bucket text not null,
          region text,
          endpoint text,
          credentials_ref text,
          created_at integer not null
        );
        create table if not exists rag_vector_stores (
          id text primary key,
          name text not null,
          type text not null,
          config text,
          created_at integer not null
        );
        create table if not exists rag_collections (
          id text primary key,
          name text not null,
          scope text not null,
          agent_id text,
          encoding_config_id text not null,
          document_store_id text not null,
          vector_store_id text,
          created_at integer not null
        );
        create table if not exists rag_documents (
          id text primary key,
          collection_id text not null,
          external_id text,
          store_path text not null,
          mime_type text,
          metadata text,
          created_at integer not null
        );
        create table if not exists rag_connectors (
          id text primary key,
          type text not null,
          collection_id text not null,
          config text not null,
          status text not null,
          last_sync_at integer,
          created_at integer not null
        );
        create table if not exists rag_vectors (
          id text primary key,
          collection_id text not null,
          document_id text not null,
          chunk_index integer not null,
          text text not null,
          embedding text not null,
          created_at integer not null
        );
        create table if not exists improvement_jobs (
          id text primary key,
          name text,
          scope_type text,
          scope_id text,
          student_llm_config_id text,
          teacher_llm_config_id text,
          current_model_ref text,
          instance_refs text,
          architecture_spec text,
          last_trained_at integer,
          last_feedback_at integer,
          created_at integer not null
        );
        create table if not exists technique_insights (
          id text primary key,
          job_id text not null,
          run_id text,
          technique_or_strategy text not null,
          outcome text not null,
          summary text not null,
          config text,
          created_at integer not null
        );
        create table if not exists technique_playbook (
          id text primary key,
          name text not null,
          description text,
          when_to_use text,
          downsides text,
          interactions text,
          observed text,
          updated_at integer not null
        );
        create table if not exists guardrails (
          id text primary key,
          scope text not null,
          scope_id text,
          config text not null,
          created_at integer not null
        );
        create table if not exists agent_store_entries (
          id text primary key,
          scope text not null,
          scope_id text not null,
          store_name text not null,
          key text not null,
          value text not null,
          created_at integer not null
        );
        create table if not exists training_runs (
          id text primary key,
          job_id text not null,
          backend text not null,
          status text not null,
          dataset_ref text,
          output_model_ref text,
          config text,
          created_at integer not null,
          finished_at integer
        );
        create table if not exists reminders (
          id text primary key,
          run_at integer not null,
          message text not null,
          conversation_id text,
          task_type text not null,
          status text not null,
          created_at integer not null,
          fired_at integer
        );
      `;

export const createSqliteAdapter = (filePath: string): SqliteAdapter => {
  const sqlite = new Database(filePath);
  const db = drizzle(sqlite);

  return {
    db,
    close: () => sqlite.close(),
    backupToPath: (targetPath: string) => sqlite.backup(targetPath).then(() => {}),
    restoreFromPath: async (sourcePath: string) => {
      const absolute = path.resolve(sourcePath);
      const escaped = absolute.replace(/\\/g, "/").replace(/'/g, "''");
      sqlite.exec(`ATTACH DATABASE '${escaped}' AS backup`);
      try {
        const rows = sqlite.prepare("SELECT name FROM backup.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
        for (const { name } of rows) {
          const quoted = `"${name.replace(/"/g, '""')}"`;
          sqlite.exec(`DELETE FROM main.${quoted}`);
          sqlite.exec(`INSERT INTO main.${quoted} SELECT * FROM backup.${quoted}`);
        }
      } finally {
        sqlite.exec("DETACH DATABASE backup");
      }
    },
    resetDatabase: () => {
      const tables = [
        "reminders", "training_runs", "agent_store_entries", "guardrails", "technique_insights", "technique_playbook", "improvement_jobs",
        "rag_vectors", "rag_connectors", "rag_documents", "rag_collections", "rag_vector_stores", "rag_document_stores", "rag_encoding_configs",
        "tasks", "sandbox_site_bindings", "feedback", "remote_servers", "model_pricing", "token_usage",
        "message_queue_log", "custom_functions", "sandboxes", "files", "chat_messages", "conversations", "assistant_memory", "chat_assistant_settings", "saved_credentials", "vault_meta", "contexts",
        "agent_skills", "skills", "run_logs", "executions", "llm_configs", "prompts", "tools", "workflows", "agents"
      ];
      for (const table of tables) {
        sqlite.exec(`DROP TABLE IF EXISTS ${table}`);
      }
      sqlite.exec(SCHEMA_SQL);
    },
    initialize: () => {
      sqlite.exec(SCHEMA_SQL);
      try {
        sqlite.exec("ALTER TABLE workflows ADD COLUMN max_rounds integer");
      } catch {
        // Column already exists
      }
      try {
        sqlite.exec("ALTER TABLE workflows ADD COLUMN turn_instruction text");
      } catch {
        // Column already exists
      }
      try {
        sqlite.exec("ALTER TABLE workflows ADD COLUMN branches text");
      } catch {
        // Column already exists
      }
      try {
        sqlite.exec("ALTER TABLE workflows ADD COLUMN execution_order text");
      } catch {
        // Column already exists
      }
      try {
        sqlite.exec("ALTER TABLE executions ADD COLUMN target_branch_id text");
      } catch {
        // Column already exists
      }
      try {
        sqlite.exec("ALTER TABLE executions ADD COLUMN conversation_id text");
      } catch {
        // Column already exists
      }
      try {
        sqlite.exec("ALTER TABLE sandbox_site_bindings ADD COLUMN host_port integer");
      } catch {
        // Column already exists or table missing (created with new schema)
      }
      try {
        sqlite.exec("ALTER TABLE agents ADD COLUMN rag_collection_id text");
      } catch {
        // Column already exists
      }
      try {
        sqlite.exec("CREATE TABLE IF NOT EXISTS conversations (id text primary key, title text, rating integer, note text, summary text, last_used_provider text, last_used_model text, created_at integer not null)");
      } catch {
        // Already exists
      }
      try {
        sqlite.exec("ALTER TABLE conversations ADD COLUMN summary text");
      } catch {
        // Column already exists
      }
      try {
        sqlite.exec("ALTER TABLE conversations ADD COLUMN last_used_provider text");
      } catch {
        // Column already exists
      }
      try {
        sqlite.exec("ALTER TABLE conversations ADD COLUMN last_used_model text");
      } catch {
        // Column already exists
      }
      try {
        sqlite.exec("CREATE TABLE IF NOT EXISTS assistant_memory (id text primary key, key text, content text not null, created_at integer not null)");
      } catch {
        // Already exists
      }
      try {
        sqlite.exec("ALTER TABLE chat_messages ADD COLUMN conversation_id text");
      } catch {
        // Column already exists
      }
      try {
        sqlite.exec("CREATE TABLE IF NOT EXISTS chat_assistant_settings (id text primary key, custom_system_prompt text, context_agent_ids text, context_workflow_ids text, context_tool_ids text, recent_summaries_count integer, temperature real, updated_at integer not null)");
      } catch {
        // Already exists
      }
      try {
        sqlite.exec("ALTER TABLE chat_assistant_settings ADD COLUMN recent_summaries_count integer");
      } catch {
        // Column already exists
      }
      try {
        sqlite.exec("ALTER TABLE chat_assistant_settings ADD COLUMN temperature real");
      } catch {
        // Column already exists
      }
      try {
        sqlite.exec("ALTER TABLE chat_assistant_settings ADD COLUMN history_compress_after integer");
      } catch {
        // Column already exists
      }
      try {
        sqlite.exec("ALTER TABLE chat_assistant_settings ADD COLUMN history_keep_recent integer");
      } catch {
        // Column already exists
      }
      try {
        sqlite.exec("ALTER TABLE rag_collections ADD COLUMN vector_store_id text");
      } catch {
        // Column already exists
      }
      try {
        sqlite.exec("ALTER TABLE chat_messages ADD COLUMN llm_trace text");
      } catch {
        // Column already exists
      }
      try {
        sqlite.exec("ALTER TABLE chat_messages ADD COLUMN rephrased_prompt text");
      } catch {
        // Column already exists
      }
      try {
        sqlite.exec("CREATE TABLE IF NOT EXISTS saved_credentials (key text primary key, value text not null, created_at integer not null)");
      } catch {
        // Already exists
      }
      try {
        sqlite.exec('CREATE TABLE IF NOT EXISTS vault_meta (id text primary key, salt text not null, "check" text not null, created_at integer not null)');
      } catch {
        // Already exists
      }
      try {
        sqlite.exec("CREATE TABLE IF NOT EXISTS message_queue_log (id text primary key, conversation_id text not null, message_id text, type text not null, phase text, label text, payload text, created_at integer not null)");
      } catch {
        // Already exists
      }
      try {
        sqlite.exec("ALTER TABLE reminders ADD COLUMN task_type text");
      } catch {
        // Column already exists
      }
      try {
        sqlite.exec("UPDATE reminders SET task_type = 'message' WHERE task_type IS NULL");
      } catch {
        // Table might not exist yet
      }
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS improvement_jobs (id text primary key, name text, scope_type text, scope_id text, student_llm_config_id text, teacher_llm_config_id text, current_model_ref text, instance_refs text, architecture_spec text, last_trained_at integer, last_feedback_at integer, created_at integer not null);
        CREATE TABLE IF NOT EXISTS technique_insights (id text primary key, job_id text not null, run_id text, technique_or_strategy text not null, outcome text not null, summary text not null, config text, created_at integer not null);
        CREATE TABLE IF NOT EXISTS technique_playbook (id text primary key, name text not null, description text, when_to_use text, downsides text, interactions text, observed text, updated_at integer not null);
        CREATE TABLE IF NOT EXISTS guardrails (id text primary key, scope text not null, scope_id text, config text not null, created_at integer not null);
        CREATE TABLE IF NOT EXISTS agent_store_entries (id text primary key, scope text not null, scope_id text not null, store_name text not null, key text not null, value text not null, created_at integer not null);
        CREATE TABLE IF NOT EXISTS training_runs (id text primary key, job_id text not null, backend text not null, status text not null, dataset_ref text, output_model_ref text, config text, created_at integer not null, finished_at integer);
        CREATE TABLE IF NOT EXISTS reminders (id text primary key, run_at integer not null, message text not null, conversation_id text, task_type text not null, status text not null, created_at integer not null, fired_at integer);
      `);
    }
  };
};
