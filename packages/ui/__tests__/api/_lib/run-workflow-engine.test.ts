import { describe, it, expect } from "vitest";
import {
  mergeNodeConfigWithRunInputs,
  getVisibleTurnNodeIds,
  applyWorkflowParamOverwrites,
} from "../../../app/api/_lib/run-workflow-engine";

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

describe("getVisibleTurnNodeIds", () => {
  it("returns predecessor node id when one edge points to the node (edge-scoped)", () => {
    const nodes = [
      { id: "a", parameters: {} },
      { id: "b", parameters: {} },
    ];
    const edges = [{ from: "a", to: "b" }];
    expect(getVisibleTurnNodeIds("b", nodes, edges)).toEqual(["a"]);
    expect(getVisibleTurnNodeIds("a", nodes, edges)).toEqual([]);
  });

  it("returns empty when node has no incoming edge and is first in list", () => {
    const nodes = [
      { id: "a", parameters: {} },
      { id: "b", parameters: {} },
    ];
    const edges = [{ from: "a", to: "b" }];
    expect(getVisibleTurnNodeIds("a", nodes, edges)).toEqual([]);
  });

  it("returns previous node in list when no edges (linear fallback)", () => {
    const nodes = [
      { id: "first", parameters: {} },
      { id: "second", parameters: {} },
    ];
    const edges: { from: string; to: string }[] = [];
    expect(getVisibleTurnNodeIds("second", nodes, edges)).toEqual(["first"]);
  });

  it("includes shared-context node ids when includeMyOutputInSharedContext is true", () => {
    const nodes = [
      { id: "a", parameters: {} },
      { id: "b", parameters: { includeMyOutputInSharedContext: true } },
      { id: "c", parameters: {} },
    ];
    const edges = [{ from: "a", to: "c" }];
    expect(getVisibleTurnNodeIds("c", nodes, edges)).toEqual(expect.arrayContaining(["a", "b"]));
    expect(getVisibleTurnNodeIds("c", nodes, edges)).toHaveLength(2);
  });

  it("node with no edge sees only shared-context contributors", () => {
    const nodes = [
      { id: "a", parameters: { includeMyOutputInSharedContext: true } },
      { id: "b", parameters: {} },
      { id: "c", parameters: {} },
    ];
    const edges = [{ from: "a", to: "b" }];
    expect(getVisibleTurnNodeIds("c", nodes, edges)).toEqual(["a"]);
  });

  it("includeMyOutputInSharedContext as string 'true' is accepted", () => {
    const nodes = [
      { id: "a", parameters: { includeMyOutputInSharedContext: "true" } },
      { id: "b", parameters: {} },
    ];
    const edges: { from: string; to: string }[] = [];
    expect(getVisibleTurnNodeIds("b", nodes, edges)).toEqual(["a"]);
  });
});

describe("applyWorkflowParamOverwrites", () => {
  it("returns input unchanged when runInputs is undefined", () => {
    const input = { sandboxId: "targetSandboxId", command: "id" };
    expect(applyWorkflowParamOverwrites("std-execute-code", input, undefined)).toEqual(input);
  });

  it("replaces literal targetSandboxId with runInputs.targetSandboxId for std-execute-code", () => {
    const input = { sandboxId: "targetSandboxId", command: "tail -50 /var/log/apache2/access.log" };
    const runInputs = {
      targetSandboxId: "5bf912ad-2759-4720-ae1a-b9665d4a463f",
      targetUrl: "http://127.0.0.1:18200",
    };
    const out = applyWorkflowParamOverwrites("std-execute-code", input, runInputs) as Record<
      string,
      unknown
    >;
    expect(out.sandboxId).toBe("5bf912ad-2759-4720-ae1a-b9665d4a463f");
    expect(out.command).toBe(input.command);
  });

  it("replaces missing sandboxId with runInputs.targetSandboxId for std-execute-code", () => {
    const input = { command: "id" };
    const runInputs = { targetSandboxId: "abc-123" };
    const out = applyWorkflowParamOverwrites("std-execute-code", input, runInputs) as Record<
      string,
      unknown
    >;
    expect(out.sandboxId).toBe("abc-123");
  });

  it("leaves valid sandboxId unchanged for std-execute-code", () => {
    const input = { sandboxId: "5bf912ad-2759-4720-ae1a-b9665d4a463f", command: "id" };
    const runInputs = { targetSandboxId: "other-id" };
    const out = applyWorkflowParamOverwrites("std-execute-code", input, runInputs) as Record<
      string,
      unknown
    >;
    expect(out.sandboxId).toBe("5bf912ad-2759-4720-ae1a-b9665d4a463f");
  });

  it("replaces ${targetUrl} with runInputs.targetUrl for std-fetch-url", () => {
    const input = { url: "${targetUrl}", method: "GET", headers: {}, body: "" };
    const runInputs = { targetUrl: "http://127.0.0.1:18200" };
    const out = applyWorkflowParamOverwrites("std-fetch-url", input, runInputs) as Record<
      string,
      unknown
    >;
    expect(out.url).toBe("http://127.0.0.1:18200");
  });

  it("replaces targetUrl (no braces) with runInputs.targetUrl for std-http-request", () => {
    const input = { url: "targetUrl", method: "GET", headers: {} };
    const runInputs = { targetUrl: "http://127.0.0.1:18200/cgi-bin/" };
    const out = applyWorkflowParamOverwrites("std-http-request", input, runInputs) as Record<
      string,
      unknown
    >;
    expect(out.url).toBe("http://127.0.0.1:18200/cgi-bin/");
  });

  it("replaces {targetUrl} with runInputs.targetUrl", () => {
    const input = { url: "{targetUrl}", method: "GET" };
    const runInputs = { targetUrl: "http://127.0.0.1:18200" };
    const out = applyWorkflowParamOverwrites("std-fetch-url", input, runInputs) as Record<
      string,
      unknown
    >;
    expect(out.url).toBe("http://127.0.0.1:18200");
  });

  it("leaves valid url unchanged for std-fetch-url", () => {
    const input = { url: "http://127.0.0.1:18200", method: "GET" };
    const runInputs = { targetUrl: "http://other.example.com" };
    const out = applyWorkflowParamOverwrites("std-fetch-url", input, runInputs) as Record<
      string,
      unknown
    >;
    expect(out.url).toBe("http://127.0.0.1:18200");
  });

  it("interpolates ${targetUrl} inside url for std-http-request", () => {
    const input = { url: "${targetUrl}/cgi-bin/vulnerable", method: "GET", headers: {} };
    const runInputs = { targetUrl: "http://127.0.0.1:18200" };
    const out = applyWorkflowParamOverwrites("std-http-request", input, runInputs) as Record<
      string,
      unknown
    >;
    expect(out.url).toBe("http://127.0.0.1:18200/cgi-bin/vulnerable");
  });

  it("interpolates {targetUrl} inside url for std-fetch-url", () => {
    const input = { url: "{targetUrl}/api/cve?search=Shellshock", method: "GET" };
    const runInputs = { targetUrl: "http://127.0.0.1:18200" };
    const out = applyWorkflowParamOverwrites("std-fetch-url", input, runInputs) as Record<
      string,
      unknown
    >;
    expect(out.url).toBe("http://127.0.0.1:18200/api/cve?search=Shellshock");
  });

  it("leaves url unchanged when it contains no targetUrl placeholder", () => {
    const input = { url: "http://other.example.com/cgi-bin/", method: "GET" };
    const runInputs = { targetUrl: "http://127.0.0.1:18200" };
    const out = applyWorkflowParamOverwrites("std-http-request", input, runInputs) as Record<
      string,
      unknown
    >;
    expect(out.url).toBe("http://other.example.com/cgi-bin/");
  });

  it("returns input unchanged when input is not an object", () => {
    expect(applyWorkflowParamOverwrites("std-execute-code", null, { targetSandboxId: "x" })).toBe(
      null
    );
    expect(applyWorkflowParamOverwrites("std-fetch-url", "string", { targetUrl: "http://x" })).toBe(
      "string"
    );
  });
});
