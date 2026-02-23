import { describe, it, expect } from "vitest";
import { shouldOpenConnectorsTab } from "../../../app/knowledge/_lib/deep-link";

describe("Knowledge deep-link", () => {
  it("shouldOpenConnectorsTab returns true when tab=connectors", () => {
    const params = new URLSearchParams("tab=connectors");
    expect(shouldOpenConnectorsTab(params)).toBe(true);
  });

  it("shouldOpenConnectorsTab returns false when tab is missing", () => {
    const params = new URLSearchParams();
    expect(shouldOpenConnectorsTab(params)).toBe(false);
  });

  it("shouldOpenConnectorsTab returns false when tab is other value", () => {
    expect(shouldOpenConnectorsTab(new URLSearchParams("tab=collections"))).toBe(false);
    expect(shouldOpenConnectorsTab(new URLSearchParams("tab=encoding"))).toBe(false);
  });

  it("shouldOpenConnectorsTab returns false when tab is connectors with different casing", () => {
    expect(shouldOpenConnectorsTab(new URLSearchParams("tab=Connectors"))).toBe(false);
  });
});
