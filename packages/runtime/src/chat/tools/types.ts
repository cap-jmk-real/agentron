/**
 * Tool definitions for the AI chat assistant.
 * Each tool maps to an internal API action the LLM can invoke.
 */
export interface AssistantToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
