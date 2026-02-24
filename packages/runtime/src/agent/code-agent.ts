import vm from "node:vm";
import type { CodeAgent, AgentExecutionContext } from "@agentron-studio/core";

export class CodeAgentExecutor {
  async execute(
    agent: CodeAgent,
    input: unknown,
    context: AgentExecutionContext
  ): Promise<unknown> {
    const sandbox = {
      module: { exports: {} },
      exports: {},
      require,
    };

    const script = new vm.Script(agent.source, { filename: "code-agent.js" });
    const runtime = vm.createContext(sandbox);
    script.runInContext(runtime);

    const moduleExports = sandbox.module.exports as Record<string, unknown>;
    const entrypoint =
      moduleExports[agent.entrypoint] ??
      (sandbox.exports as Record<string, unknown>)[agent.entrypoint] ??
      moduleExports.default;

    if (typeof entrypoint !== "function") {
      throw new Error(`Code agent entrypoint "${agent.entrypoint}" not found.`);
    }

    return await (entrypoint as (input: unknown, ctx: AgentExecutionContext) => Promise<unknown>)(
      input,
      context
    );
  }
}
