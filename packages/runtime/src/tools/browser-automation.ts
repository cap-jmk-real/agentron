/**
 * Browser automation types and stub. The real implementation lives in the UI
 * package (app/api/_lib/browser-automation.ts) so Playwright is only a
 * dependency there and works with Turbopack.
 */
export type { BrowserAutomationInput, BrowserAutomationOutput } from "./browser-automation-types";

export async function browserAutomation(
  _input: unknown
): Promise<import("./browser-automation-types").BrowserAutomationOutput> {
  throw new Error(
    "Browser automation must be invoked via the UI package; use the dynamic import from run-workflow."
  );
}
