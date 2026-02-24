/**
 * Types for browser automation (CDP). Implementation lives in the UI package
 * so that Playwright is only a dependency there and Turbopack can resolve it.
 */

export type BrowserAutomationInput = {
  action: "navigate" | "click" | "fill" | "screenshot" | "getContent" | "waitFor";
  url?: string;
  selector?: string;
  value?: string;
  timeout?: number;
};

export type BrowserAutomationOutput = {
  success: boolean;
  content?: string;
  screenshot?: string;
  error?: string;
};
