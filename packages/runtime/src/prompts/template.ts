import type { PromptTemplate } from "@agentron-studio/core";

export type PromptRenderInput = {
  input?: unknown;
  context?: Record<string, unknown>;
  args?: Record<string, unknown>;
};

const resolvePath = (obj: unknown, path: string): unknown => {
  if (!obj || typeof obj !== "object") {
    return undefined;
  }
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in acc) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
};

export const renderPromptTemplate = (
  template: PromptTemplate,
  input: PromptRenderInput
): string => {
  const args = input.args ?? {};
  const context = input.context ?? {};

  return template.template.replace(/{{\s*([^}]+)\s*}}/g, (_, rawPath) => {
    const path = String(rawPath).trim();
    if (path.startsWith("context.")) {
      const value = resolvePath(context, path.replace("context.", ""));
      return value !== undefined ? String(value) : "";
    }
    if (path.startsWith("input.")) {
      const value = resolvePath(input.input, path.replace("input.", ""));
      return value !== undefined ? String(value) : "";
    }
    const value = resolvePath(args, path);
    return value !== undefined ? String(value) : "";
  });
};

export const validatePromptArguments = (
  template: PromptTemplate,
  args: Record<string, unknown>
) => {
  const requiredArgs = template.arguments?.filter((arg) => arg.required) ?? [];
  const missing = requiredArgs.filter((arg) => args[arg.name] === undefined);

  if (missing.length > 0) {
    const names = missing.map((arg) => arg.name).join(", ");
    throw new Error(`Missing required prompt arguments: ${names}`);
  }
};
