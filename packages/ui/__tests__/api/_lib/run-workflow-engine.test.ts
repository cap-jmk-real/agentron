import { describe, it, expect } from "vitest";
import { mergeNodeConfigWithRunInputs } from "../../../app/api/_lib/run-workflow-engine";

describe("mergeNodeConfigWithRunInputs", () => {
  it("returns node parameters when runInputs is undefined", () => {
    const nodeParams = { parameters: { agentId: "a1", name: "Node 1" } };
    expect(mergeNodeConfigWithRunInputs(nodeParams, undefined)).toEqual({
      agentId: "a1",
      name: "Node 1",
    });
  });

  it("returns node parameters when runInputs is empty object", () => {
    const nodeParams = { parameters: { agentId: "a1" } };
    expect(mergeNodeConfigWithRunInputs(nodeParams, {})).toEqual({ agentId: "a1" });
  });

  it("merges runInputs into node parameters so agent receives them on first turn", () => {
    const nodeParams = { parameters: { agentId: "a1" } };
    const runInputs = { url: "https://example.com" };
    expect(mergeNodeConfigWithRunInputs(nodeParams, runInputs)).toEqual({
      agentId: "a1",
      url: "https://example.com",
    });
  });

  it("runInputs override same keys in parameters", () => {
    const nodeParams = { parameters: { agentId: "a1", url: "https://old.com" } };
    const runInputs = { url: "https://example.com" };
    expect(mergeNodeConfigWithRunInputs(nodeParams, runInputs)).toEqual({
      agentId: "a1",
      url: "https://example.com",
    });
  });

  it("uses config when parameters is missing", () => {
    const nodeParams = { config: { agentId: "a1" } };
    const runInputs = { url: "https://example.com" };
    expect(mergeNodeConfigWithRunInputs(nodeParams, runInputs)).toEqual({
      agentId: "a1",
      url: "https://example.com",
    });
  });

  it("returns empty object when node has no parameters or config and no runInputs", () => {
    expect(mergeNodeConfigWithRunInputs({}, undefined)).toEqual({});
    expect(mergeNodeConfigWithRunInputs({}, {})).toEqual({});
  });
});
