/**
 * @packageDocumentation
 * Local runtime: LLM providers, tool registry and adapters, agents (node/code), workflow engine, MCP, sandbox, chat (assistant, heap).
 * Consumed by packages/ui. Subpath export: ./browser-automation for browser automation tools.
 */
export * from "./llm";
export * from "./tools";
export * from "./prompts";
export * from "./agent";
export * from "./workflow";
export * from "./mcp";
export * from "./sandbox";
export * from "./chat";
// Re-export prompt blocks so consumers (e.g. UI chat route) can resolve them from the package entry
export { BLOCK_AGENTIC_PATTERNS, BLOCK_DESIGN_AGENTS } from "./chat/tools/prompt";
